import os
import re
import asyncio
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

import google.generativeai as genai
genai.configure(api_key=os.environ.get("GEMINI_API_KEY"))
import cloudinary
import cloudinary.uploader
cloudinary.config(secure=True)

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
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
GEMINI_MODEL = "gemini-3.1-pro-preview"  # chat / explanations
GEN_MODEL = "gemini-3.5-flash"  # QCM generation: fast, large context, robust JSON

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Object storage

APP_NAME = "edn-prep"


logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("ednprep")

app = FastAPI()
api_router = APIRouter(prefix="/api")
bearer = HTTPBearer(auto_error=False)


# ---------------------------------------------------------------------------
# Storage helpers
# ---------------------------------------------------------------------------
def put_object(path: str, data: bytes, content_type: str) -> dict:
    result = cloudinary.uploader.upload(data, resource_type="raw", public_id=path, overwrite=True,)
    return result


def get_object(path: str) -> tuple[bytes, str]:
   url, _ = cloudinary.utils.cloudinary_url(path, resource_type="raw")
   resp = requests.get(url, timeout=60)
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
    j_enabled: Optional[bool] = None
    j_offsets: Optional[List[int]] = None


class FolderUpdateIn(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    j_enabled: Optional[bool] = None
    j_offsets: Optional[List[int]] = None


class JScheduleIn(BaseModel):
    j0: Optional[str] = None  # YYYY-MM-DD
    offsets: Optional[List[int]] = None
    enabled: Optional[bool] = None


class JPresetIn(BaseModel):
    name: str
    offsets: List[int]


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


class AnswerIn(BaseModel):
    quiz_id: str
    question_id: str
    selected: List[str]


class ChatIn(BaseModel):
    folder_id: Optional[str] = None
    question: str
    context: Optional[str] = None


class ProfileIn(BaseModel):
    study_field: Optional[str] = None
    show_grade: Optional[bool] = None
    reminder_hour: Optional[int] = Field(default=None, ge=0, le=23)
    anchor_enabled: Optional[bool] = None
    anchor_size: Optional[int] = Field(default=None, ge=5, le=100)


DEFAULT_J_OFFSETS = [1, 3, 7, 15, 30]
DEFAULT_REMINDER_HOUR = 9
DEFAULT_ANCHOR_SIZE = 40
MAX_QUESTIONS = 100


def normalize_offsets(offsets: Optional[List[int]]) -> List[int]:
    if not offsets:
        return list(DEFAULT_J_OFFSETS)
    return sorted({int(o) for o in offsets if 0 < int(o) <= 365})[:30] or list(DEFAULT_J_OFFSETS)


def public_user(u: dict) -> dict:
    field = u.get("study_field")
    return {
        "id": u["id"],
        "email": u["email"],
        "name": u.get("name"),
        "study_field": field,
        "show_grade": u.get("show_grade", True),
        "reminder_hour": u.get("reminder_hour", DEFAULT_REMINDER_HOUR),
        "j_presets": u.get("j_presets", []),
        "anchor_enabled": u.get("anchor_enabled", True),
        "anchor_size": u.get("anchor_size", DEFAULT_ANCHOR_SIZE),
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
    if data.reminder_hour is not None:
        updates["reminder_hour"] = data.reminder_hour
    if data.anchor_enabled is not None:
        updates["anchor_enabled"] = data.anchor_enabled
    if data.anchor_size is not None:
        updates["anchor_size"] = data.anchor_size
    if updates:
        await db.users.update_one({"id": user["id"]}, {"$set": updates})
    fresh = await db.users.find_one({"id": user["id"]})
    return public_user(fresh)


@api_router.post("/j/presets")
async def create_preset(data: JPresetIn, user: dict = Depends(current_user)):
    preset = {"id": str(uuid.uuid4()), "name": data.name.strip() or "Ma série", "offsets": normalize_offsets(data.offsets)}
    await db.users.update_one({"id": user["id"]}, {"$push": {"j_presets": preset}})
    fresh = await db.users.find_one({"id": user["id"]})
    return public_user(fresh)


@api_router.delete("/j/presets/{preset_id}")
async def delete_preset(preset_id: str, user: dict = Depends(current_user)):
    await db.users.update_one({"id": user["id"]}, {"$pull": {"j_presets": {"id": preset_id}}})
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


async def effective_color(folder: dict) -> str:
    """Folder color, or the derived tint of the nearest ancestor that has one."""
    depth = 0
    cur = folder
    while cur:
        if cur.get("color"):
            c = cur["color"]
            for _ in range(depth):
                c = lighten_hex(c)
            return c
        if not cur.get("parent_id"):
            break
        cur = await db.folders.find_one({"id": cur["parent_id"], "deleted_at": None})
        depth += 1
    return DEFAULT_FOLDER_COLOR


# ---------------------------------------------------------------------------
# Méthode des J (spaced reminders)
# ---------------------------------------------------------------------------
async def ensure_schedule(folder: dict, owner_id: str, j0: Optional[str] = None) -> Optional[dict]:
    """Create the J schedule for a folder if it does not exist yet (J0 = today)."""
    if folder.get("j_enabled") is False:
        return None
    existing = await db.j_schedules.find_one({"folder_id": folder["id"], "owner_id": owner_id})
    if existing:
        return existing
    sched = {
        "id": str(uuid.uuid4()),
        "owner_id": owner_id,
        "folder_id": folder["id"],
        "j0": j0 or datetime.now(timezone.utc).date().isoformat(),
        "offsets": normalize_offsets(folder.get("j_offsets")),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.j_schedules.insert_one(sched)
    return sched


async def schedule_view(sched: dict) -> Optional[dict]:
    folder = await db.folders.find_one({"id": sched["folder_id"], "deleted_at": None})
    if not folder:
        return None
    topic = await get_topic(folder)
    out = clean(sched)
    out["folder_name"] = folder["name"]
    out["topic_name"] = topic["name"]
    out["color"] = await effective_color(folder)
    return out


def expand_events(view: dict, start: Optional[str] = None, end: Optional[str] = None) -> List[dict]:
    j0 = datetime.fromisoformat(view["j0"]).date()
    events = []
    for off in [0] + list(view["offsets"]):
        day = (j0 + timedelta(days=off)).isoformat()
        if (start and day < start) or (end and day > end):
            continue
        events.append(
            {
                "id": f"{view['id']}-{off}",
                "date": day,
                "offset": off,
                "label": f"J{off}",
                "folder_id": view["folder_id"],
                "folder_name": view["folder_name"],
                "topic_name": view["topic_name"],
                "color": view["color"],
            }
        )
    return events


@api_router.get("/j/schedules")
async def list_schedules(user: dict = Depends(current_user)):
    scheds = await db.j_schedules.find({"owner_id": user["id"]}).sort("created_at", -1).to_list(500)
    out = []
    for s in scheds:
        v = await schedule_view(s)
        if v:
            out.append(v)
    return out


@api_router.get("/j/schedules/{folder_id}")
async def get_schedule(folder_id: str, user: dict = Depends(current_user)):
    sched = await db.j_schedules.find_one({"folder_id": folder_id, "owner_id": user["id"]})
    if not sched:
        return None
    return await schedule_view(sched)


@api_router.put("/j/schedules/{folder_id}")
async def upsert_schedule(folder_id: str, data: JScheduleIn, user: dict = Depends(current_user)):
    folder = await db.folders.find_one({"id": folder_id, "owner_id": user["id"], "deleted_at": None})
    if not folder:
        raise HTTPException(status_code=404, detail="Dossier introuvable")
    if data.enabled is False:
        await db.j_schedules.delete_many({"folder_id": folder_id, "owner_id": user["id"]})
        await db.folders.update_one({"id": folder_id}, {"$set": {"j_enabled": False}})
        return None
    if data.j0:
        try:
            datetime.fromisoformat(data.j0)
        except ValueError:
            raise HTTPException(status_code=400, detail="Date J0 invalide")
    folder_updates: Dict[str, Any] = {"j_enabled": True}
    if data.offsets is not None:
        folder_updates["j_offsets"] = normalize_offsets(data.offsets)
    await db.folders.update_one({"id": folder_id}, {"$set": folder_updates})
    folder.update(folder_updates)
    sched = await ensure_schedule(folder, user["id"], j0=data.j0)
    updates: Dict[str, Any] = {}
    if data.j0:
        updates["j0"] = data.j0
    if data.offsets is not None:
        updates["offsets"] = folder_updates["j_offsets"]
    if updates:
        await db.j_schedules.update_one({"id": sched["id"]}, {"$set": updates})
        sched.update(updates)
    return await schedule_view(sched)


@api_router.delete("/j/schedules/{folder_id}")
async def delete_schedule(folder_id: str, user: dict = Depends(current_user)):
    await db.j_schedules.delete_many({"folder_id": folder_id, "owner_id": user["id"]})
    await db.folders.update_one({"id": folder_id, "owner_id": user["id"]}, {"$set": {"j_enabled": False}})
    return {"ok": True}


@api_router.get("/j/events")
async def list_events(
    start: str = Query(...),
    end: str = Query(...),
    user: dict = Depends(current_user),
):
    scheds = await db.j_schedules.find({"owner_id": user["id"]}).to_list(500)
    events: List[dict] = []
    for s in scheds:
        v = await schedule_view(s)
        if v:
            events.extend(expand_events(v, start, end))
    events.sort(key=lambda e: (e["date"], e["offset"]))
    return events


@api_router.get("/j/upcoming")
async def upcoming_events(user: dict = Depends(current_user)):
    """Future reminders (from today) used by the device to schedule local notifications."""
    today = datetime.now(timezone.utc).date().isoformat()
    scheds = await db.j_schedules.find({"owner_id": user["id"]}).to_list(500)
    events: List[dict] = []
    for s in scheds:
        v = await schedule_view(s)
        if v:
            events.extend(e for e in expand_events(v, start=today) if e["offset"] > 0)
    events.sort(key=lambda e: (e["date"], e["offset"]))
    return {"reminder_hour": user.get("reminder_hour", DEFAULT_REMINDER_HOUR), "events": events[:60]}


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
        "j_enabled": data.j_enabled,
        "j_offsets": normalize_offsets(data.j_offsets) if data.j_offsets else None,
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
    if data.j_enabled is not None:
        updates["j_enabled"] = data.j_enabled
    if data.j_offsets is not None:
        updates["j_offsets"] = normalize_offsets(data.j_offsets)
    if updates:
        await db.folders.update_one({"id": folder_id, "owner_id": user["id"]}, {"$set": updates})
    folder = await db.folders.find_one({"id": folder_id, "owner_id": user["id"], "deleted_at": None})
    if not folder:
        return {"ok": True}
    # Keep the J schedule in sync with the folder's J configuration.
    if data.j_enabled is False:
        await db.j_schedules.delete_many({"folder_id": folder_id, "owner_id": user["id"]})
    else:
        sched = await db.j_schedules.find_one({"folder_id": folder_id, "owner_id": user["id"]})
        if sched and data.j_offsets is not None:
            await db.j_schedules.update_one({"id": sched["id"]}, {"$set": {"offsets": updates["j_offsets"]}})
        elif not sched and data.j_enabled is True:
            has_quiz = await db.quizzes.find_one({"folder_id": folder_id, "owner_id": user["id"], "deleted_at": None})
            if has_quiz:
                await ensure_schedule(folder, user["id"])
    return clean(folder)


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
    await db.j_schedules.delete_many({"folder_id": folder_id, "owner_id": user["id"]})
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
    text_content = None
    if kind == "pdf":
        text = await run_in_threadpool(extract_pdf_text, content)
        if len(text) >= MIN_PDF_TEXT:
            text_content = text
    source = {
        "id": str(uuid.uuid4()),
        "owner_id": user["id"],
        "folder_id": folder_id,
        "name": file.filename or f"Fichier.{ext}",
        "kind": kind,
        "storage_path": path,
        "mime_type": mime,
        "text_content": text_content,
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


def build_prompt(num: int, text_blob: str, field: Optional[str] = None, part: Optional[tuple] = None) -> str:
    style = "de type EDN/PASS de difficulté élevée" if is_medecine(field) else "d'examen universitaire exigeants"
    focus = ""
    if part and part[1] > 1:
        focus = (
            f"- Ce lot est la partie {part[0]}/{part[1]} : découpe mentalement le contenu en {part[1]} parties "
            f"égales et concentre-toi UNIQUEMENT sur la partie {part[0]} pour éviter les doublons avec les autres lots.\n"
        )
    return (
        f"À partir des documents et du texte de cours fournis, génère exactement {num} QCM "
        f"{style}.\n\n"
        "Contraintes:\n"
        "- Chaque QCM a 5 propositions A, B, C, D, E.\n"
        "- Sur l'ensemble des QCM générés, environ 1 question sur 10 doit avoir une seule bonne "
        "réponse, environ 1 question sur 10 doit avoir les cinq propositions vraies (A à E), et le "
        "reste (la grande majorité) doit avoir entre 2 et 4 bonnes réponses.\n"
        "- Les questions doivent couvrir le contenu fourni.\n"
        "- L'explication doit être précise, concise (2-4 phrases) et basée sur le cours fourni.\n"
        + focus +
        "\nRéponds STRICTEMENT avec un tableau JSON valide, sans markdown, sans texte avant ou après, de cet exact format:\n"
        '[{"q":"énoncé","options":{"A":"...","B":"...","C":"...","D":"...","E":"..."},'
        '"correct":["A","C"],"explanation":"..."}]\n\n'
        + (f"TEXTE DE COURS FOURNI:\n{text_blob}\n" if text_blob else "")
    )


MIN_PDF_TEXT = 800


def extract_pdf_text(content: bytes) -> str:
    """Best-effort text extraction (fast path: avoids sending the PDF binary to the model)."""
    try:
        from pypdf import PdfReader
        import io

        reader = PdfReader(io.BytesIO(content))
        parts = []
        for page in reader.pages[:200]:
            parts.append(page.extract_text() or "")
        return "\n".join(parts).strip()
    except Exception as e:
        logger.warning("pdf text extraction failed: %s", e)
        return ""


async def _load_source_context(sources: List[dict]):
    text_parts: List[str] = []
    file_contents: List[FileContentWithMimeType] = []
    tmp_files: List[str] = []
    for s in sources:
        if s.get("text_content"):
            text_parts.append(f"[{s['name']}]\n{s['text_content'][:60000]}")
            continue
        if not s.get("storage_path"):
            continue
        try:
            content, _ = await run_in_threadpool(get_object, s["storage_path"])
            if s.get("kind") == "pdf":
                text = await run_in_threadpool(extract_pdf_text, content)
                if len(text) >= MIN_PDF_TEXT:
                    # Cache the extracted text so next generations are instant.
                    await db.sources.update_one({"id": s["id"]}, {"$set": {"text_content": text}})
                    text_parts.append(f"[{s['name']}]\n{text[:60000]}")
                    continue
            ext = s["storage_path"].split(".")[-1]
            fd, tmp_path = tempfile.mkstemp(suffix=f".{ext}")
            with os.fdopen(fd, "wb") as fh:
                fh.write(content)
            tmp_files.append(tmp_path)
            file_contents.append(FileContentWithMimeType(file_path=tmp_path, mime_type=s["mime_type"]))
        except Exception as e:
            logger.warning("skip source %s: %s", s.get("id"), e)
    return text_parts, file_contents, tmp_files


def _parse_questions(raw: str) -> List[dict]:
    parsed = _extract_json(raw)
    if isinstance(parsed, dict):
        parsed = parsed.get("questions") or parsed.get("qcm") or [parsed]
    out = []
    for item in parsed if isinstance(parsed, list) else []:
        if not isinstance(item, dict) or "options" not in item or not item.get("q"):
            continue
        out.append(
            {
                "q": item.get("q", ""),
                "options": item.get("options", {}),
                "correct": [str(c).upper() for c in item.get("correct", [])],
                "explanation": item.get("explanation", ""),
            }
        )
    return out


async def _generate_batch(system: str, prompt: str, file_contents: List, max_tokens: int = 16000) -> List[dict]:
    model = genai.GenerativeModel(model_name=GEN_MODEL.replace("gemini-", "models/gemini-") if not GEN_MODEL.startswith("models/") else GEN_MODEL, system_instruction=system)
    parts = [prompt]
    for fc in (file_contents or []):
        with open(fc.file_path, "rb") as f:
            parts.append({"mime_type": fc.mime_type, "data": f.read()})
    last_err: Optional[Exception] = None
    for _ in range(2):
        try:
            resp = await run_in_threadpool(model.generate_content, parts, generation_config={"max_output_tokens": max_tokens})
            raw = resp.text
            return _parse_questions(raw)
        except Exception as e:
            last_err = e
            logger.warning("batch failed, retrying: %s", e)
    raise last_err or RuntimeError("batch failed")


BATCH_SIZE = 10


async def run_generation_job(job_id: str):
    job = await db.generation_jobs.find_one({"id": job_id})
    if not job:
        return
    tmp_files: List[str] = []
    try:
        user = await db.users.find_one({"id": job["owner_id"]})
        root = await db.folders.find_one({"id": job["folder_id"], "deleted_at": None})
        folder_ids = await gather_folder_ids(job["folder_id"], job["owner_id"])
        sources = await db.sources.find(
            {"folder_id": {"$in": folder_ids}, "owner_id": job["owner_id"], "deleted_at": None}
        ).to_list(200)
        text_parts, file_contents, tmp_files = await _load_source_context(sources)
        await db.generation_jobs.update_one({"id": job_id}, {"$set": {"status": "running", "step": "Lecture des cours terminée"}})

        field = user.get("study_field")
        num = job["num_questions"]
        n_batches = max(1, -(-num // BATCH_SIZE))
        sizes = [num // n_batches + (1 if i < num % n_batches else 0) for i in range(n_batches)]
        blob = "\n\n".join(text_parts)
        system = build_system(field)

        tasks = [
            _generate_batch(system, build_prompt(sizes[i], blob, field, (i + 1, n_batches)), file_contents)
            for i in range(n_batches)
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        origin = await folder_meta(job["folder_id"])
        questions: List[dict] = []
        seen = set()
        for r in results:
            if isinstance(r, Exception):
                logger.error("batch error: %s", r)
                continue
            for q in r:
                key = q["q"].strip().lower()
                if key in seen:
                    continue
                seen.add(key)
                questions.append(
                    dict(
                        q,
                        id=str(uuid.uuid4()),
                        origin_folder_id=origin["folder_id"],
                        origin_folder_name=origin["folder_name"],
                        origin_topic_folder_id=origin["topic_folder_id"],
                        origin_topic_name=origin["topic_name"],
                    )
                )
        if not questions:
            raise RuntimeError("Aucune question générée, réessayez.")

        quiz = {
            "id": str(uuid.uuid4()),
            "owner_id": job["owner_id"],
            "folder_id": job["folder_id"],
            "title": f"QCM · {root['name']}",
            "kind": "generated",
            "questions": questions[:num],
            "created_at": datetime.now(timezone.utc).isoformat(),
            "deleted_at": None,
        }
        await db.quizzes.insert_one(quiz)
        # Méthode des J: J0 = the day the first QCM of this chapter is generated.
        await ensure_schedule(root, job["owner_id"])
        await db.generation_jobs.update_one(
            {"id": job_id},
            {"$set": {"status": "done", "quiz_id": quiz["id"], "question_count": len(quiz["questions"]),
                      "finished_at": datetime.now(timezone.utc).isoformat()}},
        )
    except Exception as e:
        logger.exception("generation job %s failed", job_id)
        await db.generation_jobs.update_one(
            {"id": job_id},
            {"$set": {"status": "error", "error": str(e) or "La génération a échoué, réessayez.",
                      "finished_at": datetime.now(timezone.utc).isoformat()}},
        )
    finally:
        for p in tmp_files:
            try:
                os.remove(p)
            except OSError:
                pass


@api_router.post("/quizzes/generate")
async def generate_quiz(data: GenerateIn, user: dict = Depends(current_user)):
    """Start a background generation job; poll GET /quizzes/jobs/{id} for the result."""
    root = await db.folders.find_one({"id": data.folder_id, "owner_id": user["id"], "deleted_at": None})
    if not root:
        raise HTTPException(status_code=404, detail="Dossier introuvable")
    folder_ids = await gather_folder_ids(data.folder_id, user["id"])
    has_source = await db.sources.find_one(
        {"folder_id": {"$in": folder_ids}, "owner_id": user["id"], "deleted_at": None}
    )
    if not has_source:
        raise HTTPException(status_code=400, detail="Ajoutez au moins une source (cours ou annales) dans ce dossier.")

    job = {
        "id": str(uuid.uuid4()),
        "owner_id": user["id"],
        "folder_id": data.folder_id,
        "num_questions": max(3, min(data.num_questions, MAX_QUESTIONS)),
        "status": "pending",
        "step": "Lecture des cours…",
        "quiz_id": None,
        "error": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.generation_jobs.insert_one(job)
    asyncio.create_task(run_generation_job(job["id"]))
    return clean(job)


@api_router.get("/quizzes/jobs/{job_id}")
async def get_generation_job(job_id: str, user: dict = Depends(current_user)):
    job = await db.generation_jobs.find_one({"id": job_id, "owner_id": user["id"]})
    if not job:
        raise HTTPException(status_code=404, detail="Génération introuvable")
    return clean(job)


@api_router.get("/quizzes/jobs")
async def list_generation_jobs(folder_id: str = Query(...), user: dict = Depends(current_user)):
    """Active (or recently failed) jobs for a folder, so the UI can show progress after navigating away."""
    since = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    jobs = await db.generation_jobs.find(
        {"owner_id": user["id"], "folder_id": folder_id, "created_at": {"$gte": since},
         "status": {"$in": ["pending", "running", "error"]}}
    ).sort("created_at", -1).to_list(20)
    return [clean(j) for j in jobs]


@api_router.delete("/quizzes/jobs/{job_id}")
async def dismiss_generation_job(job_id: str, user: dict = Depends(current_user)):
    await db.generation_jobs.delete_one({"id": job_id, "owner_id": user["id"]})
    return {"ok": True}


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

    size = user.get("anchor_size", DEFAULT_ANCHOR_SIZE)
    sample = random.sample(pool, min(size, len(pool)))
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


async def add_to_review(user_id: str, question: dict, quiz_folder_id: Optional[str], pts: float):
    if pts >= 1.0:
        return
    quiz_origin = await folder_meta(quiz_folder_id)
    o_folder_id = question.get("origin_folder_id", quiz_origin["folder_id"])
    o_folder_name = question.get("origin_folder_name", quiz_origin["folder_name"])
    o_topic_id = question.get("origin_topic_folder_id", quiz_origin["topic_folder_id"])
    o_topic_name = question.get("origin_topic_name", quiz_origin["topic_name"])
    now = datetime.now(timezone.utc).isoformat()
    existing = await db.review_items.find_one({"owner_id": user_id, "question.q": question["q"]})
    if existing:
        await db.review_items.update_one(
            {"id": existing["id"]},
            {"$set": {"resolved": False, "updated_at": now, "last_points": pts},
             "$inc": {"wrong_count": 1}},
        )
    else:
        await db.review_items.insert_one({
            "id": str(uuid.uuid4()),
            "owner_id": user_id,
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
        })


@api_router.post("/quizzes/answer")
async def answer_question(data: AnswerIn, user: dict = Depends(current_user)):
    qz = await db.quizzes.find_one({"id": data.quiz_id, "owner_id": user["id"], "deleted_at": None})
    if not qz:
        raise HTTPException(status_code=404, detail="QCM introuvable")
    question = next((q for q in qz.get("questions", []) if q["id"] == data.question_id), None)
    if not question:
        raise HTTPException(status_code=404, detail="Question introuvable")
    pts, disc = score_question(data.selected, question["correct"], question["options"])
    await add_to_review(user["id"], question, qz.get("folder_id"), pts)
    return {"points": pts, "discordance": disc, "correct": question["correct"]}


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

    model = genai.GenerativeModel(
        model_name=GEMINI_MODEL.replace("gemini-", "models/gemini-") if not GEMINI_MODEL.startswith("models/") else GEMINI_MODEL,
        system_instruction=system)
    parts = [prompt]
    for fc in (file_contents or []):
        with open(fc.file_path, "rb") as f:
            parts.append({"mime_type": fc.mime_type, "data": f.read()})

    try:
        resp = await run_in_threadpool(model.generate_content, parts)
    finally:
        for p in tmp_files:
            try:
                os.remove(p)
            except OSError:
                pass

    answer = resp.text
    return {"answer": answer}


def build_annale_prompt() -> str:
    return (
        "Le document fourni est une annale d'examen DÉJÀ CORRIGÉE (les bonnes réponses sont cochées, "
        "cerclées, surlignées ou marquées d'une croix sur le document).\n\n"
        "Ta tâche : retranscrire TOUTES les questions de cette annale, MOT POUR MOT, sans rien inventer, "
        "reformuler, raccourcir ni ajouter. Pour chaque question :\n"
        "- Reprends l'énoncé exactement tel qu'il est écrit.\n"
        "- Reprends chaque proposition telle qu'elle est écrite (garde le même nombre de propositions "
        "que sur le document, même si ce n'est pas toujours 5).\n"
        "- Identifie quelles propositions sont marquées comme correctes sur le document (coche, croix, "
        "cercle, surlignage) et indique-les dans \"correct\".\n"
        "- Si le document donne une explication ou un commentaire de correction, reprends-le tel quel "
        "dans \"explanation\". Sinon, laisse \"explanation\" vide (\"\").\n"
        "- Ne saute aucune question, même si l'écriture est difficile à lire : fais de ton mieux.\n\n"
        "Réponds STRICTEMENT avec un tableau JSON valide, sans markdown, sans texte avant ou après, de "
        "cet exact format:\n"
        '[{"q":"énoncé","options":{"A":"...","B":"...","C":"...","D":"...","E":"..."},'
        '"correct":["A","C"],"explanation":"..."}]\n'
    )


class _FileRef:
    def __init__(self, file_path: str, mime_type: str):
        self.file_path = file_path
        self.mime_type = mime_type


async def run_annale_job(job_id: str, content: bytes, mime: str, ext: str):
    job = await db.generation_jobs.find_one({"id": job_id})
    if not job:
        return
    tmp_path = None
    try:
        fd, tmp_path = tempfile.mkstemp(suffix=f".{ext}")
        with os.fdopen(fd, "wb") as fh:
            fh.write(content)
        await db.generation_jobs.update_one(
            {"id": job_id}, {"$set": {"status": "running", "step": "L'IA relit votre annale…"}}
        )

        root = await db.folders.find_one({"id": job["folder_id"], "deleted_at": None})
        user = await db.users.find_one({"id": job["owner_id"]})
        system = (
            "Tu es un assistant rigoureux qui retranscrit des annales d'examen corrigées, sans jamais "
            "inventer ni reformuler le contenu. Tu réponds UNIQUEMENT en JSON valide, sans texte autour."
        )
        file_contents = [_FileRef(file_path=tmp_path, mime_type=mime)]

        raw_questions = await _generate_batch(system, build_annale_prompt(), file_contents, max_tokens=32000)
        if not raw_questions:
            raise RuntimeError("Aucune question détectée dans cette annale, réessayez avec une version plus lisible.")

        origin = await folder_meta(job["folder_id"])
        questions = [
            dict(
                q,
                id=str(uuid.uuid4()),
                origin_folder_id=origin["folder_id"],
                origin_folder_name=origin["folder_name"],
                origin_topic_folder_id=origin["topic_folder_id"],
                origin_topic_name=origin["topic_name"],
            )
            for q in raw_questions
        ]

        quiz = {
            "id": str(uuid.uuid4()),
            "owner_id": job["owner_id"],
            "folder_id": job["folder_id"],
            "title": f"Annale · {root['name']}",
            "kind": "annale",
            "questions": questions,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "deleted_at": None,
        }
        await db.quizzes.insert_one(quiz)
        await ensure_schedule(root, job["owner_id"])
        await db.generation_jobs.update_one(
            {"id": job_id},
            {"$set": {"status": "done", "quiz_id": quiz["id"], "question_count": len(quiz["questions"]),
                      "finished_at": datetime.now(timezone.utc).isoformat()}},
        )
    except Exception as e:
        logger.exception("annale job %s failed", job_id)
        await db.generation_jobs.update_one(
            {"id": job_id},
            {"$set": {"status": "error", "error": str(e) or "La lecture de l'annale a échoué, réessayez.",
                      "finished_at": datetime.now(timezone.utc).isoformat()}},
        )
    finally:
        if tmp_path:
            try:
                os.remove(tmp_path)
            except OSError:
                pass


@api_router.post("/quizzes/generate-annale")
async def generate_annale_quiz(
    folder_id: str = Form(...),
    file: UploadFile = File(...),
    user: dict = Depends(current_user),
):
    root = await db.folders.find_one({"id": folder_id, "owner_id": user["id"], "deleted_at": None})
    if not root:
        raise HTTPException(status_code=404, detail="Dossier introuvable")

    content = await file.read()
    ext = (file.filename or "annale").split(".")[-1].lower()
    mime = file.content_type or "application/octet-stream"

    job = {
        "id": str(uuid.uuid4()),
        "owner_id": user["id"],
        "folder_id": folder_id,
        "num_questions": 0,
        "kind": "annale",
        "status": "pending",
        "step": "Lecture de l'annale…",
        "quiz_id": None,
        "error": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.generation_jobs.insert_one(job)
    asyncio.create_task(run_annale_job(job["id"], content, mime, ext))
    return clean(job)

class CombineIn(BaseModel):
    folder_id: str


@api_router.post("/quizzes/combine")
async def combine_quizzes(data: CombineIn, user: dict = Depends(current_user)):
    root = await db.folders.find_one({"id": data.folder_id, "owner_id": user["id"], "deleted_at": None})
    if not root:
        raise HTTPException(status_code=404, detail="Dossier introuvable")
    folder_ids = await gather_folder_ids(data.folder_id, user["id"])
    quizzes = await db.quizzes.find(
        {"folder_id": {"$in": folder_ids}, "owner_id": user["id"], "deleted_at": None}
    ).to_list(500)

    questions: List[dict] = []
    seen = set()
    for qz in quizzes:
        for q in qz.get("questions", []):
            key = q["q"].strip().lower()
            if key in seen:
                continue
            seen.add(key)
            questions.append(q)

    if not questions:
        raise HTTPException(status_code=400, detail="Aucun QCM à regrouper pour le moment.")

    quiz = {
        "id": str(uuid.uuid4()),
        "owner_id": user["id"],
        "folder_id": data.folder_id,
        "title": f"Tous les QCM · {root['name']}",
        "kind": "combined",
        "questions": questions,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "deleted_at": None,
    }
    await db.quizzes.insert_one(quiz)
    return clean(quiz)

class FlagReviewIn(BaseModel):
    quiz_id: str
    question_id: str


@api_router.post("/quizzes/flag-review")
async def flag_review(data: FlagReviewIn, user: dict = Depends(current_user)):
    qz = await db.quizzes.find_one({"id": data.quiz_id, "owner_id": user["id"], "deleted_at": None})
    if not qz:
        raise HTTPException(status_code=404, detail="QCM introuvable")
    question = next((q for q in qz.get("questions", []) if q["id"] == data.question_id), None)
    if not question:
        raise HTTPException(status_code=404, detail="Question introuvable")

    quiz_origin = await folder_meta(qz.get("folder_id"))
    o_folder_id = question.get("origin_folder_id", quiz_origin["folder_id"])
    o_folder_name = question.get("origin_folder_name", quiz_origin["folder_name"])
    o_topic_id = question.get("origin_topic_folder_id", quiz_origin["topic_folder_id"])
    o_topic_name = question.get("origin_topic_name", quiz_origin["topic_name"])
    now = datetime.now(timezone.utc).isoformat()

    existing = await db.review_items.find_one({"owner_id": user["id"], "question.q": question["q"]})
    if existing:
        await db.review_items.update_one({"id": existing["id"]}, {"$set": {"resolved": False, "updated_at": now}})
    else:
        await db.review_items.insert_one({
            "id": str(uuid.uuid4()), "owner_id": user["id"],
            "question": {
                "q": question["q"], "options": question["options"], "correct": question["correct"],
                "explanation": question["explanation"], "origin_folder_id": o_folder_id,
                "origin_folder_name": o_folder_name, "origin_topic_folder_id": o_topic_id,
                "origin_topic_name": o_topic_name,
            },
            "folder_id": o_folder_id, "folder_name": o_folder_name, "topic_folder_id": o_topic_id,
            "topic_name": o_topic_name, "wrong_count": 1, "last_points": 1.0, "resolved": False,
            "created_at": now, "updated_at": now,
        })
    return {"ok": True}

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
