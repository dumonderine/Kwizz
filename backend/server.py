import os
import re
import json
import uuid
import random
import logging
import tempfile
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any

import jwt
import requests
from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File, Form, Query
from fastapi.responses import Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.concurrency import run_in_threadpool
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field
from passlib.context import CryptContext
from dotenv import load_dotenv

from emergentintegrations.llm.chat import LlmChat, UserMessage, FileContentWithMimeType

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# ---------------------------------------------------------------------------
# Config / clients
# ---------------------------------------------------------------------------
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret")
JWT_ALG = "HS256"
JWT_EXPIRE_DAYS = 30
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY")
GEMINI_MODEL = "gemini-3.1-pro-preview"

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Object storage
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
APP_NAME = "edn-prep"
_storage_key: Optional[str] = None

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("ednprep")

app = FastAPI()
api_router = APIRouter(prefix="/api")
bearer = HTTPBearer(auto_error=False)


# ---------------------------------------------------------------------------
# Storage helpers
# ---------------------------------------------------------------------------
def init_storage() -> str:
    global _storage_key
    if _storage_key:
        return _storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_LLM_KEY}, timeout=30)
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()


def get_object(path: str) -> tuple[bytes, str]:
    global _storage_key
    key = init_storage()
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    if resp.status_code == 503:
        _storage_key = None
        key = init_storage()
        resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------
def hash_password(pw: str) -> str:
    return pwd_ctx.hash(pw[:72])


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return pwd_ctx.verify(pw[:72], hashed)
    except Exception:
        return False


def make_token(user_id: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": user_id, "iat": now, "exp": now + timedelta(days=JWT_EXPIRE_DAYS)}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def decode_token(token: str) -> Optional[str]:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        return payload.get("sub")
    except Exception:
        return None


async def current_user(creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer)) -> dict:
    if not creds:
        raise HTTPException(status_code=401, detail="Non authentifié")
    user_id = decode_token(creds.credentials)
    if not user_id:
        raise HTTPException(status_code=401, detail="Session expirée")
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=401, detail="Utilisateur introuvable")
    return user


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    name: Optional[str] = None


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class FolderIn(BaseModel):
    name: str
    parent_id: Optional[str] = None
    color: Optional[str] = None


class FolderUpdateIn(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None


class TextSourceIn(BaseModel):
    folder_id: str
    name: str
    text: str


class GenerateIn(BaseModel):
    folder_id: str
    num_questions: int = 10


class ReviewQuizIn(BaseModel):
    topic_folder_id: Optional[str] = None
    folder_id: Optional[str] = None
    num_questions: int = 15


class SubmitIn(BaseModel):
    quiz_id: str
    answers: Dict[str, List[str]]


class ChatIn(BaseModel):
    folder_id: Optional[str] = None
    question: str
    context: Optional[str] = None


class ProfileIn(BaseModel):
    study_field: Optional[str] = None
    show_grade: Optional[bool] = None


def public_user(u: dict) -> dict:
    field = u.get("study_field")
    return {
        "id": u["id"],
        "email": u["email"],
        "name": u.get("name"),
        "study_field": field,
        "show_grade": u.get("show_grade", True),
        "onboarded": bool(field),
    }


def clean(doc: dict) -> dict:
    doc = dict(doc)
    doc.pop("_id", None)
    return doc


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------
@api_router.post("/auth/register")
async def register(data: RegisterIn):
    email = data.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Cet email est déjà utilisé")
    user = {
        "id": str(uuid.uuid4()),
        "email": email,
        "name": data.name or email.split("@")[0],
        "password_hash": hash_password(data.password),
        "study_field": None,
        "show_grade": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(user)
    return {"token": make_token(user["id"]), "user": public_user(user)}


@api_router.post("/auth/login")
async def login(data: LoginIn):
    email = data.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Email ou mot de passe incorrect")
    return {"token": make_token(user["id"]), "user": public_user(user)}


@api_router.get("/auth/me")
async def me(user: dict = Depends(current_user)):
    return public_user(user)


@api_router.patch("/auth/profile")
async def update_profile(data: ProfileIn, user: dict = Depends(current_user)):
    updates: Dict[str, Any] = {}
    if data.study_field is not None:
        updates["study_field"] = data.study_field.strip()
    if data.show_grade is not None:
        updates["show_grade"] = data.show_grade
    if updates:
        await db.users.update_one({"id": user["id"]}, {"$set": updates})
    fresh = await db.users.find_one({"id": user["id"]})
    return public_user(fresh)


# ---------------------------------------------------------------------------
# Folder routes
# ---------------------------------------------------------------------------
async def get_topic(folder: dict) -> dict:
    """Walk up to the root folder (the topic)."""
    current = folder
    while current.get("parent_id"):
        parent = await db.folders.find_one({"id": current["parent_id"], "deleted_at": None})
        if not parent:
            break
        current = parent
    return current


async def folder_meta(folder_id: Optional[str]) -> dict:
    """Resolve origin metadata for a folder: its own name + its root topic."""
    if not folder_id:
        return {"folder_id": None, "folder_name": "Général", "topic_folder_id": None, "topic_name": "Général"}
    folder = await db.folders.find_one({"id": folder_id, "deleted_at": None})
    if not folder:
        return {"folder_id": folder_id, "folder_name": "Général", "topic_folder_id": None, "topic_name": "Général"}
    topic = await get_topic(folder)
    return {
        "folder_id": folder["id"],
        "folder_name": folder["name"],
        "topic_folder_id": topic["id"],
        "topic_name": topic["name"],
    }


DEFAULT_FOLDER_COLOR = "#0284c7"


def lighten_hex(hex_color: str, factor: float = 0.28) -> str:
    """Return a lighter tint of the given hex color (mix toward white)."""
    try:
        h = hex_color.lstrip("#")
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        r = int(r + (255 - r) * factor)
        g = int(g + (255 - g) * factor)
        b = int(b + (255 - b) * factor)
        return f"#{r:02x}{g:02x}{b:02x}"
    except Exception:
        return hex_color


@api_router.post("/folders")
async def create_folder(data: FolderIn, user: dict = Depends(current_user)):
    color = data.color
    if not color:
        if data.parent_id:
            parent = await db.folders.find_one(
                {"id": data.parent_id, "owner_id": user["id"], "deleted_at": None}
            )
            color = lighten_hex(parent.get("color") or DEFAULT_FOLDER_COLOR) if parent else DEFAULT_FOLDER_COLOR
        else:
            color = DEFAULT_FOLDER_COLOR
    folder = {
        "id": str(uuid.uuid4()),
        "owner_id": user["id"],
        "name": data.name.strip(),
        "parent_id": data.parent_id,
        "color": color,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "deleted_at": None,
    }
    await db.folders.insert_one(folder)
    return clean(folder)


@api_router.patch("/folders/{folder_id}")
async def update_folder(folder_id: str, data: FolderUpdateIn, user: dict = Depends(current_user)):
    updates: Dict[str, Any] = {}
    if data.name is not None:
        updates["name"] = data.name.strip()
    if data.color is not None:
        updates["color"] = data.color
    if updates:
        await db.folders.update_one({"id": folder_id, "owner_id": user["id"]}, {"$set": updates})
    folder = await db.folders.find_one({"id": folder_id, "owner_id": user["id"], "deleted_at": None})
    return clean(folder) if folder else {"ok": True}


@api_router.get("/folders")
async def list_folders(parent_id: Optional[str] = Query(None), user: dict = Depends(current_user)):
    q = {"owner_id": user["id"], "parent_id": parent_id, "deleted_at": None}
    folders = await db.folders.find(q).sort("created_at", 1).to_list(500)
    result = []
    for f in folders:
        sub = await db.folders.count_documents({"parent_id": f["id"], "deleted_at": None})
        src = await db.sources.count_documents({"folder_id": f["id"], "deleted_at": None})
        item = clean(f)
        item["subfolder_count"] = sub
        item["source_count"] = src
        result.append(item)
    return result


@api_router.get("/folders/{folder_id}")
async def get_folder(folder_id: str, user: dict = Depends(current_user)):
    folder = await db.folders.find_one({"id": folder_id, "owner_id": user["id"], "deleted_at": None})
    if not folder:
        raise HTTPException(status_code=404, detail="Dossier introuvable")
    crumbs = []
    cur = folder
    while cur:
        crumbs.insert(0, {"id": cur["id"], "name": cur["name"]})
        if cur.get("parent_id"):
            cur = await db.folders.find_one({"id": cur["parent_id"], "deleted_at": None})
        else:
            cur = None
    out = clean(folder)
    out["breadcrumb"] = crumbs
    return out


@api_router.delete("/folders/{folder_id}")
async def delete_folder(folder_id: str, user: dict = Depends(current_user)):
    now = datetime.now(timezone.utc).isoformat()
    await db.folders.update_one(
        {"id": folder_id, "owner_id": user["id"]}, {"$set": {"deleted_at": now}}
    )
    return {"ok": True}


# ---------------------------------------------------------------------------
# Source routes
# ---------------------------------------------------------------------------
@api_router.post("/sources/upload")
async def upload_source(
    folder_id: str = Form(...),
    file: UploadFile = File(...),
    user: dict = Depends(current_user),
):
    content = await file.read()
    ext = (file.filename or "file").split(".")[-1].lower()
    mime = file.content_type or "application/octet-stream"
    kind = "pdf" if "pdf" in mime or ext == "pdf" else ("image" if mime.startswith("image") else "file")
    path = f"{APP_NAME}/uploads/{user['id']}/{uuid.uuid4()}.{ext}"
    await run_in_threadpool(put_object, path, content, mime)
    source = {
        "id": str(uuid.uuid4()),
        "owner_id": user["id"],
        "folder_id": folder_id,
        "name": file.filename or f"Fichier.{ext}",
        "kind": kind,
        "storage_path": path,
        "mime_type": mime,
        "text_content": None,
        "size": len(content),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "deleted_at": None,
    }
    await db.sources.insert_one(source)
    return clean(source)


@api_router.post("/sources/text")
async def create_text_source(data: TextSourceIn, user: dict = Depends(current_user)):
    source = {
        "id": str(uuid.uuid4()),
        "owner_id": user["id"],
        "folder_id": data.folder_id,
        "name": data.name.strip() or "Texte collé",
        "kind": "text",
        "storage_path": None,
        "mime_type": "text/plain",
        "text_content": data.text,
        "size": len(data.text),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "deleted_at": None,
    }
    await db.sources.insert_one(source)
    return clean(source)


@api_router.get("/sources")
async def list_sources(folder_id: str = Query(...), user: dict = Depends(current_user)):
    q = {"owner_id": user["id"], "folder_id": folder_id, "deleted_at": None}
    sources = await db.sources.find(q).sort("created_at", 1).to_list(500)
    return [clean(s) for s in sources]


@api_router.delete("/sources/{source_id}")
async def delete_source(source_id: str, user: dict = Depends(current_user)):
    now = datetime.now(timezone.utc).isoformat()
    await db.sources.update_one({"id": source_id, "owner_id": user["id"]}, {"$set": {"deleted_at": now}})
    return {"ok": True}


@api_router.get("/files/{path:path}")
async def get_file(path: str, token: Optional[str] = Query(None)):
    user_id = decode_token(token) if token else None
    if not user_id:
        raise HTTPException(status_code=401, detail="Non authentifié")
    src = await db.sources.find_one({"storage_path": path, "owner_id": user_id})
    if not src:
        raise HTTPException(status_code=404, detail="Fichier introuvable")
    data, ctype = await run_in_threadpool(get_object, path)
    return Response(content=data, media_type=ctype)


# ---------------------------------------------------------------------------
# Quiz generation (Gemini)
# ---------------------------------------------------------------------------
async def gather_folder_ids(root_id: str, owner_id: str) -> List[str]:
    ids = [root_id]
    queue = [root_id]
    while queue:
        pid = queue.pop()
        children = await db.folders.find(
            {"parent_id": pid, "owner_id": owner_id, "deleted_at": None}
        ).to_list(500)
        for c in children:
            ids.append(c["id"])
            queue.append(c["id"])
    return ids


def _extract_json(text: str) -> Any:
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()
    start = text.find("[")
    if start == -1:
        start = text.find("{")
    end = max(text.rfind("]"), text.rfind("}"))
    if start != -1 and end != -1:
        text = text[start : end + 1]
    return json.loads(text)


def is_medecine(field: Optional[str]) -> bool:
    if not field:
        return False
    f = field.lower()
    return "méd" in f or "med" in f or "pass" in f or "las" in f or "edn" in f


def build_system(field: Optional[str]) -> str:
    if is_medecine(field):
        return (
            "Tu es un professeur de médecine expert qui rédige des QCM au format EDN/PASS français. "
            "Tu crées des questions rigoureuses, avec des pièges classiques d'examen. "
            "Chaque question a 5 propositions (A à E), et UNE OU PLUSIEURS peuvent être vraies. "
            "Les explications doivent être tirées DIRECTEMENT du contenu du cours fourni. "
            "Tu réponds UNIQUEMENT en JSON valide, sans texte autour."
        )
    domain = f" en {field}" if field else ""
    return (
        f"Tu es un professeur expert{domain} qui rédige des QCM d'examen universitaire rigoureux. "
        "Chaque question a 5 propositions (A à E), et UNE OU PLUSIEURS peuvent être vraies. "
        "Les explications doivent être tirées DIRECTEMENT du contenu du cours fourni. "
        "Tu réponds UNIQUEMENT en JSON valide, sans texte autour."
    )


def build_prompt(num: int, text_blob: str, field: Optional[str] = None) -> str:
    style = "de type EDN/PASS de difficulté élevée" if is_medecine(field) else "d'examen universitaire exigeants"
    return (
        f"À partir des documents et du texte de cours fournis, génère exactement {num} QCM "
        f"{style}.\n\n"
        "Contraintes:\n"
        "- Chaque QCM a 5 propositions A, B, C, D, E.\n"
        "- Une ou plusieurs propositions peuvent être vraies (indique toutes les bonnes lettres).\n"
        "- Les questions doivent couvrir l'ensemble du contenu fourni.\n"
        "- L'explication doit être précise et basée sur le cours fourni.\n\n"
        "Réponds STRICTEMENT avec un tableau JSON de cet exact format:\n"
        '[{"q":"énoncé","options":{"A":"...","B":"...","C":"...","D":"...","E":"..."},'
        '"correct":["A","C"],"explanation":"..."}]\n\n'
        + (f"TEXTE DE COURS FOURNI:\n{text_blob}\n" if text_blob else "")
    )


async def _load_source_context(sources: List[dict]):
    text_parts: List[str] = []
    file_contents: List[FileContentWithMimeType] = []
    tmp_files: List[str] = []
    for s in sources:
        if s["kind"] == "text" and s.get("text_content"):
            text_parts.append(f"[{s['name']}]\n{s['text_content'][:15000]}")
        elif s.get("storage_path"):
            try:
                content, _ = await run_in_threadpool(get_object, s["storage_path"])
                ext = s["storage_path"].split(".")[-1]
                fd, tmp_path = tempfile.mkstemp(suffix=f".{ext}")
                with os.fdopen(fd, "wb") as fh:
                    fh.write(content)
                tmp_files.append(tmp_path)
                file_contents.append(FileContentWithMimeType(file_path=tmp_path, mime_type=s["mime_type"]))
            except Exception as e:
                logger.warning("skip source %s: %s", s.get("id"), e)
    return text_parts, file_contents, tmp_files


@api_router.post("/quizzes/generate")
async def generate_quiz(data: GenerateIn, user: dict = Depends(current_user)):
    root = await db.folders.find_one({"id": data.folder_id, "owner_id": user["id"], "deleted_at": None})
    if not root:
        raise HTTPException(status_code=404, detail="Dossier introuvable")

    folder_ids = await gather_folder_ids(data.folder_id, user["id"])
    sources = await db.sources.find(
        {"folder_id": {"$in": folder_ids}, "owner_id": user["id"], "deleted_at": None}
    ).to_list(200)
    if not sources:
        raise HTTPException(status_code=400, detail="Ajoutez au moins une source (cours ou annales) dans ce dossier.")

    text_parts, file_contents, tmp_files = await _load_source_context(sources)

    field = user.get("study_field")
    num = max(3, min(data.num_questions, 30))
    prompt = build_prompt(num, "\n\n".join(text_parts), field)

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"gen-{uuid.uuid4()}",
        system_message=build_system(field),
    ).with_model("gemini", GEMINI_MODEL)

    try:
        resp = await chat.send_message(UserMessage(text=prompt, file_contents=file_contents or None))
    finally:
        for p in tmp_files:
            try:
                os.remove(p)
            except OSError:
                pass

    raw = resp if isinstance(resp, str) else getattr(resp, "text", None) or str(resp)
    try:
        parsed = _extract_json(raw)
    except Exception as e:
        logger.error("JSON parse failed: %s\n%s", e, raw[:500])
        raise HTTPException(status_code=502, detail="La génération a échoué, réessayez.")

    questions = []
    origin = await folder_meta(data.folder_id)
    for item in parsed:
        if not isinstance(item, dict) or "options" not in item:
            continue
        questions.append(
            {
                "id": str(uuid.uuid4()),
                "q": item.get("q", ""),
                "options": item.get("options", {}),
                "correct": [c.upper() for c in item.get("correct", [])],
                "explanation": item.get("explanation", ""),
                "origin_folder_id": origin["folder_id"],
                "origin_folder_name": origin["folder_name"],
                "origin_topic_folder_id": origin["topic_folder_id"],
                "origin_topic_name": origin["topic_name"],
            }
        )
    if not questions:
        raise HTTPException(status_code=502, detail="Aucune question générée, réessayez.")

    quiz = {
        "id": str(uuid.uuid4()),
        "owner_id": user["id"],
        "folder_id": data.folder_id,
        "title": f"QCM · {root['name']}",
        "kind": "generated",
        "questions": questions,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "deleted_at": None,
    }
    await db.quizzes.insert_one(quiz)
    return clean(quiz)


@api_router.post("/review/quiz")
async def review_quiz(data: ReviewQuizIn, user: dict = Depends(current_user)):
    q: Dict[str, Any] = {"owner_id": user["id"], "resolved": False}
    if data.folder_id:
        q["folder_id"] = data.folder_id
    elif data.topic_folder_id:
        q["topic_folder_id"] = data.topic_folder_id
    items = await db.review_items.find(q).sort("updated_at", -1).to_list(500)
    if not items:
        raise HTTPException(status_code=400, detail="Aucun QCM à revoir pour le moment.")
    items = items[: max(3, min(data.num_questions, 40))]
    questions = [dict(it["question"], id=str(uuid.uuid4())) for it in items]
    title = "QCM à revoir"
    if items:
        first = items[0]
        if data.folder_id:
            title = f"À revoir · {first.get('folder_name', first.get('topic_name', ''))}"
        elif data.topic_folder_id:
            title = f"À revoir · {first.get('topic_name', '')}"
    quiz = {
        "id": str(uuid.uuid4()),
        "owner_id": user["id"],
        "folder_id": data.folder_id or data.topic_folder_id,
        "title": title,
        "kind": "review",
        "questions": questions,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "deleted_at": None,
    }
    await db.quizzes.insert_one(quiz)
    return clean(quiz)


@api_router.get("/anchor/status")
async def anchor_status(user: dict = Depends(current_user)):
    quizzes = await db.quizzes.find(
        {"owner_id": user["id"], "kind": "generated", "deleted_at": None}
    ).to_list(500)
    pool = sum(len(q.get("questions", [])) for q in quizzes)
    today = datetime.now(timezone.utc).date().isoformat()
    todays = await db.quizzes.find_one(
        {"owner_id": user["id"], "kind": "anchor", "anchor_date": today, "deleted_at": None}
    )
    done = False
    if todays:
        att = await db.attempts.find_one({"owner_id": user["id"], "quiz_id": todays["id"]})
        done = att is not None
    return {"pool_size": pool, "available": pool > 0, "done_today": done}


@api_router.post("/anchor/daily")
async def anchor_daily(user: dict = Depends(current_user)):
    today = datetime.now(timezone.utc).date().isoformat()
    existing = await db.quizzes.find_one(
        {"owner_id": user["id"], "kind": "anchor", "anchor_date": today, "deleted_at": None}
    )
    if existing:
        return clean(existing)

    quizzes = await db.quizzes.find(
        {"owner_id": user["id"], "kind": "generated", "deleted_at": None}
    ).to_list(1000)

    pool: List[dict] = []
    seen = set()
    for qz in quizzes:
        for question in qz.get("questions", []):
            key = question.get("q", "")
            if not key or key in seen:
                continue
            seen.add(key)
            pool.append(question)

    if not pool:
        raise HTTPException(status_code=400, detail="Générez d'abord des QCM dans vos dossiers.")

    sample = random.sample(pool, min(40, len(pool)))
    questions = [dict(q, id=str(uuid.uuid4())) for q in sample]

    quiz = {
        "id": str(uuid.uuid4()),
        "owner_id": user["id"],
        "folder_id": None,
        "title": "Ancrage du jour",
        "kind": "anchor",
        "anchor_date": today,
        "questions": questions,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "deleted_at": None,
    }
    await db.quizzes.insert_one(quiz)
    return clean(quiz)


@api_router.get("/quizzes")
async def list_quizzes(folder_id: str = Query(...), user: dict = Depends(current_user)):
    q = {"owner_id": user["id"], "folder_id": folder_id, "deleted_at": None}
    quizzes = await db.quizzes.find(q).sort("created_at", -1).to_list(200)
    out = []
    for qz in quizzes:
        item = clean(qz)
        item["question_count"] = len(item.get("questions", []))
        item.pop("questions", None)
        out.append(item)
    return out


@api_router.get("/quizzes/{quiz_id}")
async def get_quiz(quiz_id: str, user: dict = Depends(current_user)):
    qz = await db.quizzes.find_one({"id": quiz_id, "owner_id": user["id"], "deleted_at": None})
    if not qz:
        raise HTTPException(status_code=404, detail="QCM introuvable")
    return clean(qz)


@api_router.delete("/quizzes/{quiz_id}")
async def delete_quiz(quiz_id: str, user: dict = Depends(current_user)):
    now = datetime.now(timezone.utc).isoformat()
    await db.quizzes.update_one({"id": quiz_id, "owner_id": user["id"]}, {"$set": {"deleted_at": now}})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Scoring + review
# ---------------------------------------------------------------------------
def score_question(selected: List[str], correct: List[str], options: dict) -> tuple[float, int]:
    letters = list(options.keys()) or ["A", "B", "C", "D", "E"]
    sel = set(x.upper() for x in selected)
    cor = set(x.upper() for x in correct)
    discordance = sum(1 for l in letters if (l in sel) != (l in cor))
    if discordance == 0:
        return 1.0, 0
    if discordance == 1:
        return 0.5, 1
    if discordance == 2:
        return 0.2, 2
    return 0.0, discordance


@api_router.post("/quizzes/submit")
async def submit_quiz(data: SubmitIn, user: dict = Depends(current_user)):
    qz = await db.quizzes.find_one({"id": data.quiz_id, "owner_id": user["id"], "deleted_at": None})
    if not qz:
        raise HTTPException(status_code=404, detail="QCM introuvable")

    folder = None
    topic = None
    if qz.get("folder_id"):
        folder = await db.folders.find_one({"id": qz["folder_id"], "deleted_at": None})
        if folder:
            topic = await get_topic(folder)

    total = 0.0
    results = []
    review_added = 0
    now = datetime.now(timezone.utc).isoformat()

    # Quiz-level origin (fallback when a question has no per-question origin).
    quiz_origin = await folder_meta(qz.get("folder_id"))

    for question in qz.get("questions", []):
        selected = data.answers.get(question["id"], [])
        pts, disc = score_question(selected, question["correct"], question["options"])
        total += pts
        results.append(
            {
                "question_id": question["id"],
                "selected": selected,
                "correct": question["correct"],
                "points": pts,
                "discordance": disc,
            }
        )
        if pts < 1.0:
            review_added += 1
            # Prefer per-question origin (anchor quizzes mix many folders).
            o_folder_id = question.get("origin_folder_id", quiz_origin["folder_id"])
            o_folder_name = question.get("origin_folder_name", quiz_origin["folder_name"])
            o_topic_id = question.get("origin_topic_folder_id", quiz_origin["topic_folder_id"])
            o_topic_name = question.get("origin_topic_name", quiz_origin["topic_name"])
            existing = await db.review_items.find_one(
                {"owner_id": user["id"], "question.q": question["q"]}
            )
            if existing:
                await db.review_items.update_one(
                    {"id": existing["id"]},
                    {"$set": {"resolved": False, "updated_at": now, "last_points": pts},
                     "$inc": {"wrong_count": 1}},
                )
            else:
                await db.review_items.insert_one(
                    {
                        "id": str(uuid.uuid4()),
                        "owner_id": user["id"],
                        "question": {
                            "q": question["q"],
                            "options": question["options"],
                            "correct": question["correct"],
                            "explanation": question["explanation"],
                            "origin_folder_id": o_folder_id,
                            "origin_folder_name": o_folder_name,
                            "origin_topic_folder_id": o_topic_id,
                            "origin_topic_name": o_topic_name,
                        },
                        "folder_id": o_folder_id,
                        "folder_name": o_folder_name,
                        "topic_folder_id": o_topic_id,
                        "topic_name": o_topic_name,
                        "wrong_count": 1,
                        "last_points": pts,
                        "resolved": False,
                        "created_at": now,
                        "updated_at": now,
                    }
                )

    n = len(qz.get("questions", [])) or 1
    grade_on_20 = round((total / n) * 20, 2)

    attempt = {
        "id": str(uuid.uuid4()),
        "owner_id": user["id"],
        "quiz_id": data.quiz_id,
        "folder_id": qz.get("folder_id"),
        "title": qz.get("title"),
        "total_points": round(total, 2),
        "max_points": n,
        "grade_on_20": grade_on_20,
        "created_at": now,
    }
    await db.attempts.insert_one(attempt)

    return {
        "total_points": round(total, 2),
        "max_points": n,
        "grade_on_20": grade_on_20,
        "review_added": review_added,
        "results": results,
    }


# ---------------------------------------------------------------------------
# Review pool
# ---------------------------------------------------------------------------
@api_router.get("/review/topics")
async def review_topics(user: dict = Depends(current_user)):
    items = await db.review_items.find({"owner_id": user["id"], "resolved": False}).to_list(2000)
    groups: Dict[str, dict] = {}
    for it in items:
        # Group by the exact origin sub-folder so wrong questions land in
        # e.g. "Neurologie › Chapitre 3", not just the top topic.
        fid = it.get("folder_id") or it.get("topic_folder_id") or "general"
        if fid not in groups:
            topic = it.get("topic_name", "Général")
            folder = it.get("folder_name", topic)
            label = folder if folder == topic else f"{topic} › {folder}"
            groups[fid] = {
                "folder_id": it.get("folder_id"),
                "topic_folder_id": it.get("topic_folder_id"),
                "folder_name": it.get("folder_name", topic),
                "topic_name": topic,
                "label": label,
                "count": 0,
            }
        groups[fid]["count"] += 1
    return {"total": len(items), "topics": list(groups.values())}


@api_router.get("/review")
async def list_review(folder_id: Optional[str] = Query(None), user: dict = Depends(current_user)):
    q: Dict[str, Any] = {"owner_id": user["id"], "resolved": False}
    if folder_id:
        q["folder_id"] = folder_id
    items = await db.review_items.find(q).sort("updated_at", -1).to_list(1000)
    return [clean(it) for it in items]


@api_router.post("/review/{item_id}/resolve")
async def resolve_review(item_id: str, user: dict = Depends(current_user)):
    await db.review_items.update_one(
        {"id": item_id, "owner_id": user["id"]}, {"$set": {"resolved": True}}
    )
    return {"ok": True}


# ---------------------------------------------------------------------------
# Attempts history
# ---------------------------------------------------------------------------
@api_router.get("/attempts")
async def list_attempts(user: dict = Depends(current_user)):
    items = await db.attempts.find({"owner_id": user["id"]}).sort("created_at", -1).to_list(50)
    return [clean(it) for it in items]


# ---------------------------------------------------------------------------
# AI course chat
# ---------------------------------------------------------------------------
@api_router.post("/chat")
async def course_chat(data: ChatIn, user: dict = Depends(current_user)):
    text_parts: List[str] = []
    file_contents: List[FileContentWithMimeType] = []
    tmp_files: List[str] = []

    if data.folder_id:
        folder_ids = await gather_folder_ids(data.folder_id, user["id"])
        sources = await db.sources.find(
            {"folder_id": {"$in": folder_ids}, "owner_id": user["id"], "deleted_at": None}
        ).to_list(50)
        text_parts, file_contents, tmp_files = await _load_source_context(sources)

    system = (
        "Tu es un tuteur de médecine bienveillant et rigoureux. Réponds en français de façon "
        "claire et pédagogique. Appuie-toi en priorité sur les documents de cours fournis. "
        "Si l'information n'est pas dans le cours, précise-le puis complète avec tes connaissances."
    )
    prompt = data.question
    if data.context:
        prompt = f"Contexte (QCM en cours):\n{data.context}\n\nQuestion de l'étudiant: {data.question}"
    if text_parts:
        prompt = f"{prompt}\n\nEXTRAITS DE COURS:\n" + "\n\n".join(text_parts)

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"chat-{user['id']}-{data.folder_id or 'gen'}",
        system_message=system,
    ).with_model("gemini", GEMINI_MODEL)

    try:
        resp = await chat.send_message(UserMessage(text=prompt, file_contents=file_contents or None))
    finally:
        for p in tmp_files:
            try:
                os.remove(p)
            except OSError:
                pass

    answer = resp if isinstance(resp, str) else getattr(resp, "text", None) or str(resp)
    return {"answer": answer}


@api_router.get("/")
async def root():
    return {"message": "EDN Prep API"}


# ---------------------------------------------------------------------------
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    try:
        await run_in_threadpool(init_storage)
        logger.info("storage initialised")
    except Exception as e:
        logger.warning("storage init failed: %s", e)
    try:
        await db.users.create_index("email", unique=True)
    except Exception as e:
        logger.warning("index create failed: %s", e)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
