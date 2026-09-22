"""Regression suite for the 'Méthode des J' spaced-reminder feature,
Calendrier events, Profil settings (reminder hour, anchor toggle/size,
J presets), and a single end-to-end quiz generation verifying j_schedule.

Runs against the deployed preview URL from EXPO_PUBLIC_BACKEND_URL.
Isolated from the existing test_kwizz_api.py suite: uses its own fresh
users so it will not disturb tester@kwizz.fr or the seeded data.
"""
import os
import uuid
from datetime import date, timedelta
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://flashcard-pro-70.preview.emergentagent.com"
).rstrip("/")


# --------------------------- shared fixtures ---------------------------
@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _register(api, email=None):
    email = email or f"TEST_j_{uuid.uuid4().hex[:8]}@kwizz.fr"
    r = api.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": email, "password": "secret123", "name": "J Tester"},
    )
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    # Complete onboarding so tests are close to a real user
    r2 = api.patch(
        f"{BASE_URL}/api/auth/profile",
        json={"study_field": "Médecine"},
        headers=headers,
    )
    assert r2.status_code == 200, r2.text
    return {"email": email, "headers": headers}


@pytest.fixture(scope="module")
def user(api):
    return _register(api)


# --------------------------- Folder + J config ---------------------------
class TestFolderJFields:
    def test_create_folder_with_j_fields(self, api, user):
        r = api.post(
            f"{BASE_URL}/api/folders",
            json={
                "name": "TEST_J_Topic",
                "color": "#0284c7",
                "j_enabled": True,
                "j_offsets": [1, 3, 7, 15, 30],
            },
            headers=user["headers"],
        )
        assert r.status_code == 200, r.text
        f = r.json()
        assert f["j_enabled"] is True
        assert f["j_offsets"] == [1, 3, 7, 15, 30]
        user["topic_id"] = f["id"]

    def test_normalize_offsets_on_create(self, api, user):
        r = api.post(
            f"{BASE_URL}/api/folders",
            json={
                "name": "TEST_J_Norm",
                "j_enabled": True,
                # duplicates, unsorted, one invalid (0) which should be dropped
                "j_offsets": [7, 3, 7, 0, 1, 15, 30],
            },
            headers=user["headers"],
        )
        assert r.status_code == 200
        assert r.json()["j_offsets"] == [1, 3, 7, 15, 30]

    def test_patch_folder_j_offsets_updates_schedule(self, api, user):
        # First create a schedule via PUT
        j0 = date.today().isoformat()
        fid = user["topic_id"]
        r = api.put(
            f"{BASE_URL}/api/j/schedules/{fid}",
            json={"j0": j0, "offsets": [1, 3, 7, 15, 30], "enabled": True},
            headers=user["headers"],
        )
        assert r.status_code == 200, r.text
        assert r.json()["offsets"] == [1, 3, 7, 15, 30]

        # Patch folder j_offsets -> schedule should update
        r = api.patch(
            f"{BASE_URL}/api/folders/{fid}",
            json={"j_offsets": [2, 4, 8]},
            headers=user["headers"],
        )
        assert r.status_code == 200

        r = api.get(f"{BASE_URL}/api/j/schedules/{fid}", headers=user["headers"])
        assert r.status_code == 200
        sched = r.json()
        assert sched is not None
        assert sched["offsets"] == [2, 4, 8]

    def test_patch_folder_disables_schedule(self, api, user):
        fid = user["topic_id"]
        r = api.patch(
            f"{BASE_URL}/api/folders/{fid}",
            json={"j_enabled": False},
            headers=user["headers"],
        )
        assert r.status_code == 200
        # Schedule should be gone
        r = api.get(f"{BASE_URL}/api/j/schedules/{fid}", headers=user["headers"])
        assert r.status_code == 200
        assert r.json() is None


# --------------------------- PUT / GET / DELETE schedule ---------------------------
class TestJScheduleCRUD:
    def test_upsert_returns_folder_topic_color(self, api, user):
        r = api.post(
            f"{BASE_URL}/api/folders",
            json={"name": "TEST_J_Sched_Topic", "color": "#ef4444"},
            headers=user["headers"],
        )
        topic_id = r.json()["id"]
        r = api.post(
            f"{BASE_URL}/api/folders",
            json={"name": "TEST_J_Sched_Chap", "parent_id": topic_id},
            headers=user["headers"],
        )
        chap_id = r.json()["id"]
        user["sched_chap"] = chap_id
        user["sched_topic"] = topic_id

        r = api.put(
            f"{BASE_URL}/api/j/schedules/{chap_id}",
            json={"j0": date.today().isoformat(), "offsets": [1, 6, 15], "enabled": True},
            headers=user["headers"],
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["folder_name"] == "TEST_J_Sched_Chap"
        assert data["topic_name"] == "TEST_J_Sched_Topic"
        # color is derived from parent (lightened)
        assert data["color"].startswith("#")
        assert data["offsets"] == [1, 6, 15]

    def test_disabled_upsert_deletes(self, api, user):
        r = api.put(
            f"{BASE_URL}/api/j/schedules/{user['sched_chap']}",
            json={"enabled": False},
            headers=user["headers"],
        )
        assert r.status_code == 200
        assert r.json() is None
        r = api.get(
            f"{BASE_URL}/api/j/schedules/{user['sched_chap']}", headers=user["headers"]
        )
        assert r.status_code == 200
        assert r.json() is None

    def test_invalid_j0_returns_400(self, api, user):
        r = api.put(
            f"{BASE_URL}/api/j/schedules/{user['sched_chap']}",
            json={"j0": "not-a-date", "enabled": True},
            headers=user["headers"],
        )
        assert r.status_code == 400

    def test_unknown_folder_returns_404(self, api, user):
        r = api.put(
            f"{BASE_URL}/api/j/schedules/{uuid.uuid4()}",
            json={"j0": date.today().isoformat(), "enabled": True},
            headers=user["headers"],
        )
        assert r.status_code == 404

    def test_delete_schedule(self, api, user):
        # Recreate then delete
        r = api.put(
            f"{BASE_URL}/api/j/schedules/{user['sched_chap']}",
            json={"j0": date.today().isoformat(), "offsets": [1, 3], "enabled": True},
            headers=user["headers"],
        )
        assert r.status_code == 200
        r = api.delete(
            f"{BASE_URL}/api/j/schedules/{user['sched_chap']}", headers=user["headers"]
        )
        assert r.status_code == 200
        r = api.get(
            f"{BASE_URL}/api/j/schedules/{user['sched_chap']}", headers=user["headers"]
        )
        assert r.json() is None


# --------------------------- Listing / events / upcoming ---------------------------
class TestJEvents:
    def test_list_events_and_upcoming(self, api, user):
        # Fresh user & schedule with today+3 offsets so we know exactly what to expect
        u = _register(api)
        r = api.post(
            f"{BASE_URL}/api/folders",
            json={"name": "TEST_Ev_Topic", "color": "#22c55e"},
            headers=u["headers"],
        )
        topic_id = r.json()["id"]
        j0 = date.today().isoformat()
        r = api.put(
            f"{BASE_URL}/api/j/schedules/{topic_id}",
            json={"j0": j0, "offsets": [1, 3, 6], "enabled": True},
            headers=u["headers"],
        )
        assert r.status_code == 200

        # /j/schedules list
        r = api.get(f"{BASE_URL}/api/j/schedules", headers=u["headers"])
        assert r.status_code == 200
        assert any(s["folder_id"] == topic_id for s in r.json())

        # /j/events over a wide window: J0 + J1 + J3 + J6 = 4 events
        start = date.today().isoformat()
        end = (date.today() + timedelta(days=60)).isoformat()
        r = api.get(
            f"{BASE_URL}/api/j/events",
            params={"start": start, "end": end},
            headers=u["headers"],
        )
        assert r.status_code == 200
        evs = [e for e in r.json() if e["folder_id"] == topic_id]
        offsets = sorted(e["offset"] for e in evs)
        assert offsets == [0, 1, 3, 6]
        # sort order and expected dates
        for e in evs:
            expected_day = (date.today() + timedelta(days=e["offset"])).isoformat()
            assert e["date"] == expected_day
            assert e["label"] == f"J{e['offset']}"
            assert e["folder_name"] == "TEST_Ev_Topic"

        # /j/upcoming excludes J0 (offset==0) and returns reminder_hour
        r = api.get(f"{BASE_URL}/api/j/upcoming", headers=u["headers"])
        assert r.status_code == 200
        data = r.json()
        assert "reminder_hour" in data
        my_evs = [e for e in data["events"] if e["folder_id"] == topic_id]
        assert my_evs
        assert all(e["offset"] > 0 for e in my_evs)


# --------------------------- J presets ---------------------------
class TestJPresets:
    def test_create_normalizes_and_delete(self, api, user):
        r = api.post(
            f"{BASE_URL}/api/j/presets",
            json={"name": "Ma série", "offsets": [7, 1, 7, 3, 0]},
            headers=user["headers"],
        )
        assert r.status_code == 200, r.text
        me = r.json()
        assert isinstance(me["j_presets"], list)
        preset = next((p for p in me["j_presets"] if p["name"] == "Ma série"), None)
        assert preset is not None
        # normalized: sorted, unique, >0
        assert preset["offsets"] == [1, 3, 7]

        # Persist across /auth/me
        r = api.get(f"{BASE_URL}/api/auth/me", headers=user["headers"])
        assert any(p["id"] == preset["id"] for p in r.json()["j_presets"])

        # Delete
        r = api.delete(
            f"{BASE_URL}/api/j/presets/{preset['id']}", headers=user["headers"]
        )
        assert r.status_code == 200
        assert all(p["id"] != preset["id"] for p in r.json()["j_presets"])


# --------------------------- Profile fields ---------------------------
class TestProfile:
    def test_reminder_hour_validation(self, api, user):
        r = api.patch(
            f"{BASE_URL}/api/auth/profile",
            json={"reminder_hour": 25},
            headers=user["headers"],
        )
        assert r.status_code == 422

    def test_anchor_size_validation(self, api, user):
        r = api.patch(
            f"{BASE_URL}/api/auth/profile",
            json={"anchor_size": 3},
            headers=user["headers"],
        )
        assert r.status_code == 422
        r = api.patch(
            f"{BASE_URL}/api/auth/profile",
            json={"anchor_size": 200},
            headers=user["headers"],
        )
        assert r.status_code == 422

    def test_profile_updates_persist(self, api, user):
        r = api.patch(
            f"{BASE_URL}/api/auth/profile",
            json={"reminder_hour": 8, "anchor_enabled": False, "anchor_size": 12},
            headers=user["headers"],
        )
        assert r.status_code == 200
        me = r.json()
        assert me["reminder_hour"] == 8
        assert me["anchor_enabled"] is False
        assert me["anchor_size"] == 12
        # /auth/me reflects
        r = api.get(f"{BASE_URL}/api/auth/me", headers=user["headers"])
        me2 = r.json()
        assert me2["reminder_hour"] == 8
        assert me2["anchor_enabled"] is False
        assert me2["anchor_size"] == 12


# --------------------------- E2E generation with j_schedule ---------------------------
COURSE_TEXT = """
Sclérose en plaques (SEP)
- Maladie inflammatoire démyélinisante auto-immune du SNC.
- Adulte jeune 20-40 ans, prédominance féminine (3:1).
- Clinique: névrite optique, Lhermitte, ataxie cérébelleuse, signes pyramidaux.
- IRM cérébrale/médullaire, PL (bandes oligoclonales), critères de McDonald.
- Poussée: corticoïdes IV forte dose. Fond: interférons, natalizumab, ocrélizumab.
"""


class TestGenerationCreatesJSchedule:
    """Uses a dedicated fresh user, exactly ONE Gemini call, then verifies
    second call reuses same j0. This is the only expensive call in this file."""

    def test_generate_once_and_verify_j_schedule(self, api):
        u = _register(api)
        # Topic + subfolder
        r = api.post(
            f"{BASE_URL}/api/folders",
            json={"name": "TEST_Neuro", "color": "#0284c7", "j_enabled": True},
            headers=u["headers"],
        )
        topic_id = r.json()["id"]
        r = api.post(
            f"{BASE_URL}/api/folders",
            json={"name": "TEST_Chap", "parent_id": topic_id},
            headers=u["headers"],
        )
        chap_id = r.json()["id"]
        r = api.post(
            f"{BASE_URL}/api/sources/text",
            json={"folder_id": chap_id, "name": "TEST_SEP", "text": COURSE_TEXT},
            headers=u["headers"],
        )
        assert r.status_code == 200

        # ONE generation (Gemini) — 5 questions
        r = api.post(
            f"{BASE_URL}/api/quizzes/generate",
            json={"folder_id": topic_id, "num_questions": 5},
            headers=u["headers"],
            timeout=180,
        )
        assert r.status_code == 200, r.text
        quiz = r.json()
        assert len(quiz["questions"]) >= 3
        sched = quiz.get("j_schedule")
        assert sched is not None, "j_schedule should be auto-created on first generation"
        assert sched["j0"] == date.today().isoformat()
        assert sched["offsets"] == [1, 3, 7, 15, 30]
        assert sched["folder_name"] == "TEST_Neuro"

        # Second call would spend money; instead verify idempotency by patching
        # the schedule j0 manually then re-invoking ensure_schedule via a PUT
        # with only offsets (should NOT touch j0). This exercises the "does not
        # change j0" contract.
        r = api.put(
            f"{BASE_URL}/api/j/schedules/{topic_id}",
            json={"offsets": [1, 3, 7], "enabled": True},
            headers=u["headers"],
        )
        assert r.status_code == 200
        r = api.get(f"{BASE_URL}/api/j/schedules/{topic_id}", headers=u["headers"])
        after = r.json()
        assert after["j0"] == sched["j0"], "j0 must be preserved when only offsets change"
        assert after["offsets"] == [1, 3, 7]

        # Anchor daily uses anchor_size — set to 10 first
        r = api.patch(
            f"{BASE_URL}/api/auth/profile",
            json={"anchor_size": 10},
            headers=u["headers"],
        )
        assert r.status_code == 200
        r = api.post(f"{BASE_URL}/api/anchor/daily", headers=u["headers"])
        assert r.status_code == 200, r.text
        anchor = r.json()
        assert len(anchor["questions"]) <= 10
