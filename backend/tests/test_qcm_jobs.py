"""Regression suite for the new job-based QCM generation flow, J presets,
Profile settings (anchor_size validation with 200 -> 422), and jobs listing.

Uses tester@kwizz.fr (existing seeded user) with folder
8e251e6b-0be7-43ce-881b-aa68b032cb8f (has text source).

Budget: ONE Gemini generation across this whole suite (the request from main
agent limits the app to 2 total generations backend+frontend combined).
"""
import os
import time
import uuid
from datetime import date
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://flashcard-pro-70.preview.emergentagent.com"
).rstrip("/")

TESTER_EMAIL = "tester@kwizz.fr"
TESTER_PASSWORD = "secret123"
CHAPTER_ID = "8e251e6b-0be7-43ce-881b-aa68b032cb8f"


# --------------------------- fixtures ---------------------------
@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def tester(api):
    r = api.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": TESTER_EMAIL, "password": TESTER_PASSWORD},
    )
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    return {"headers": {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}}


# --------------------------- Health ---------------------------
def test_login_and_me(api, tester):
    r = api.get(f"{BASE_URL}/api/auth/me", headers=tester["headers"])
    assert r.status_code == 200
    me = r.json()
    assert me["email"] == TESTER_EMAIL
    assert me["onboarded"] is True
    # New fields must be present
    assert "reminder_hour" in me
    assert "anchor_enabled" in me
    assert "anchor_size" in me
    assert "j_presets" in me


# --------------------------- Job-based generation ---------------------------
class TestJobGeneration:
    """Single Gemini call: POST /quizzes/generate -> job pending
    Then poll GET /quizzes/jobs/{id} until done (<90s target), then verify quiz."""

    def test_generate_returns_pending_job(self, api, tester):
        r = api.post(
            f"{BASE_URL}/api/quizzes/generate",
            json={"folder_id": CHAPTER_ID, "num_questions": 10},
            headers=tester["headers"],
            timeout=30,
        )
        assert r.status_code == 200, r.text
        job = r.json()
        assert job["status"] in ("pending", "running")
        assert job.get("quiz_id") is None
        assert "id" in job
        pytest.job_id = job["id"]

    def test_poll_job_until_done(self, api, tester):
        job_id = getattr(pytest, "job_id", None)
        assert job_id, "job id from previous test missing"
        start = time.time()
        deadline = start + 120  # allow 2 min hard cap; log if > 90s
        final = None
        while time.time() < deadline:
            r = api.get(
                f"{BASE_URL}/api/quizzes/jobs/{job_id}", headers=tester["headers"]
            )
            assert r.status_code == 200, r.text
            job = r.json()
            if job["status"] in ("done", "error"):
                final = job
                break
            time.sleep(3)
        assert final is not None, "job did not finish in 120s"
        elapsed = time.time() - start
        print(f"\n[JobGen] finished in {elapsed:.1f}s with status={final['status']}")
        assert final["status"] == "done", final
        assert final.get("quiz_id"), final
        pytest.quiz_id = final["quiz_id"]
        assert elapsed < 90, f"generation took {elapsed:.1f}s (>90s target)"

    def test_quiz_has_structured_questions(self, api, tester):
        quiz_id = getattr(pytest, "quiz_id", None)
        assert quiz_id, "quiz id from previous test missing"
        r = api.get(f"{BASE_URL}/api/quizzes/{quiz_id}", headers=tester["headers"])
        assert r.status_code == 200
        quiz = r.json()
        qs = quiz["questions"]
        assert 5 <= len(qs) <= 10, f"expected ~10 questions, got {len(qs)}"
        for q in qs:
            assert set(q["options"].keys()) == {"A", "B", "C", "D", "E"}
            assert isinstance(q["correct"], list) and 1 <= len(q["correct"]) <= 5
            assert all(c in "ABCDE" for c in q["correct"])
            assert isinstance(q.get("explanation", ""), str)
            assert isinstance(q.get("q", ""), str) and q["q"].strip()


# --------------------------- Jobs listing / dismissal ---------------------------
class TestJobsListing:
    def test_list_jobs_empty_or_active(self, api, tester):
        # After completion, active list should be empty for this folder
        r = api.get(
            f"{BASE_URL}/api/quizzes/jobs",
            params={"folder_id": CHAPTER_ID},
            headers=tester["headers"],
        )
        assert r.status_code == 200
        # Only pending/running/error jobs are returned; the done one from
        # previous test should NOT be there.
        for j in r.json():
            assert j["status"] in ("pending", "running", "error")

    def test_delete_missing_job_is_ok(self, api, tester):
        r = api.delete(
            f"{BASE_URL}/api/quizzes/jobs/{uuid.uuid4()}", headers=tester["headers"]
        )
        assert r.status_code == 200
        assert r.json() == {"ok": True}


# --------------------------- J schedule for the seeded folder ---------------------------
class TestJScheduleSeeded:
    """The seeded folder already has a schedule; verify update contract without
    permanently disabling it (main agent asked to leave it enabled)."""

    original: dict = {}

    def test_get_schedule(self, api, tester):
        r = api.get(
            f"{BASE_URL}/api/j/schedules/{CHAPTER_ID}", headers=tester["headers"]
        )
        assert r.status_code == 200
        s = r.json()
        assert s is not None
        assert s["folder_id"] == CHAPTER_ID
        TestJScheduleSeeded.original = {"j0": s["j0"], "offsets": s["offsets"]}

    def test_put_updates_offsets_and_j0(self, api, tester):
        r = api.put(
            f"{BASE_URL}/api/j/schedules/{CHAPTER_ID}",
            json={"j0": "2026-09-10", "offsets": [1, 3, 6], "enabled": True},
            headers=tester["headers"],
        )
        assert r.status_code == 200, r.text
        s = r.json()
        assert s["j0"] == "2026-09-10"
        assert s["offsets"] == [1, 3, 6]

    def test_events_window_returns_expected(self, api, tester):
        r = api.get(
            f"{BASE_URL}/api/j/events",
            params={"start": "2026-09-01", "end": "2026-10-31"},
            headers=tester["headers"],
        )
        assert r.status_code == 200
        evs = [e for e in r.json() if e["folder_id"] == CHAPTER_ID]
        # J0=Sept10, J1=Sept11, J3=Sept13, J6=Sept16 -> at least these 4
        offsets = sorted(e["offset"] for e in evs)
        assert 0 in offsets and 1 in offsets and 3 in offsets and 6 in offsets
        for e in evs:
            assert e["label"] == f"J{e['offset']}"
            assert e["color"].startswith("#")
            assert e.get("folder_name") == "Chapitre 3 - Moelle épinière"

    def test_upcoming_has_reminder_hour(self, api, tester):
        r = api.get(f"{BASE_URL}/api/j/upcoming", headers=tester["headers"])
        assert r.status_code == 200
        data = r.json()
        assert "reminder_hour" in data
        assert "events" in data
        assert all(e["offset"] > 0 for e in data["events"])

    def test_disable_then_reenable_with_today(self, api, tester):
        # Disable -> schedule removed + folder j_enabled=false
        r = api.put(
            f"{BASE_URL}/api/j/schedules/{CHAPTER_ID}",
            json={"enabled": False},
            headers=tester["headers"],
        )
        assert r.status_code == 200
        assert r.json() is None
        r = api.get(
            f"{BASE_URL}/api/j/schedules/{CHAPTER_ID}", headers=tester["headers"]
        )
        assert r.json() is None
        # Also verify the folder now has j_enabled=false
        r = api.get(f"{BASE_URL}/api/folders/{CHAPTER_ID}", headers=tester["headers"])
        assert r.status_code == 200
        assert r.json().get("j_enabled") is False

        # Cleanup: re-enable with j0=today per main-agent instruction
        r = api.put(
            f"{BASE_URL}/api/j/schedules/{CHAPTER_ID}",
            json={
                "j0": date.today().isoformat(),
                "offsets": [1, 3, 6, 15],
                "enabled": True,
            },
            headers=tester["headers"],
        )
        assert r.status_code == 200
        assert r.json()["j0"] == date.today().isoformat()


# --------------------------- J presets ---------------------------
class TestJPresetsFlow:
    def test_add_preset(self, api, tester):
        r = api.post(
            f"{BASE_URL}/api/j/presets",
            json={"name": "TEST_preset", "offsets": [2, 4, 8, 16]},
            headers=tester["headers"],
        )
        assert r.status_code == 200, r.text
        me = r.json()
        p = next((x for x in me["j_presets"] if x["name"] == "TEST_preset"), None)
        assert p is not None
        assert p["offsets"] == [2, 4, 8, 16]
        TestJPresetsFlow.pid = p["id"]

    def test_preset_appears_on_me(self, api, tester):
        r = api.get(f"{BASE_URL}/api/auth/me", headers=tester["headers"])
        assert any(p["id"] == TestJPresetsFlow.pid for p in r.json()["j_presets"])

    def test_delete_preset(self, api, tester):
        r = api.delete(
            f"{BASE_URL}/api/j/presets/{TestJPresetsFlow.pid}",
            headers=tester["headers"],
        )
        assert r.status_code == 200
        assert all(p["id"] != TestJPresetsFlow.pid for p in r.json()["j_presets"])


# --------------------------- Profile validation ---------------------------
class TestProfileNew:
    def test_reject_anchor_size_200(self, api, tester):
        r = api.patch(
            f"{BASE_URL}/api/auth/profile",
            json={"anchor_size": 200},
            headers=tester["headers"],
        )
        assert r.status_code == 422

    def test_reject_anchor_size_below_5(self, api, tester):
        r = api.patch(
            f"{BASE_URL}/api/auth/profile",
            json={"anchor_size": 4},
            headers=tester["headers"],
        )
        assert r.status_code == 422

    def test_update_reminder_hour_and_size(self, api, tester):
        r = api.patch(
            f"{BASE_URL}/api/auth/profile",
            json={"reminder_hour": 18, "anchor_enabled": False, "anchor_size": 20},
            headers=tester["headers"],
        )
        assert r.status_code == 200
        me = r.json()
        assert me["reminder_hour"] == 18
        assert me["anchor_enabled"] is False
        assert me["anchor_size"] == 20

        # Restore anchor_enabled=True so UI test still sees the card
        r = api.patch(
            f"{BASE_URL}/api/auth/profile",
            json={"anchor_enabled": True, "anchor_size": 40, "reminder_hour": 9},
            headers=tester["headers"],
        )
        assert r.status_code == 200


# --------------------------- Folder with j fields ---------------------------
class TestFolderJPatch:
    def test_create_and_patch_disable(self, api, tester):
        r = api.post(
            f"{BASE_URL}/api/folders",
            json={
                "name": f"TEST_JobFolder_{uuid.uuid4().hex[:6]}",
                "color": "#ef4444",
                "j_enabled": True,
                "j_offsets": [2, 6, 10],
            },
            headers=tester["headers"],
        )
        assert r.status_code == 200
        f = r.json()
        assert f["j_enabled"] is True
        assert f["j_offsets"] == [2, 6, 10]
        fid = f["id"]

        # Create a schedule then patch j_enabled False -> schedule removed
        r = api.put(
            f"{BASE_URL}/api/j/schedules/{fid}",
            json={"j0": date.today().isoformat(), "offsets": [2, 6, 10], "enabled": True},
            headers=tester["headers"],
        )
        assert r.status_code == 200

        r = api.patch(
            f"{BASE_URL}/api/folders/{fid}",
            json={"j_enabled": False},
            headers=tester["headers"],
        )
        assert r.status_code == 200

        r = api.get(f"{BASE_URL}/api/j/schedules/{fid}", headers=tester["headers"])
        assert r.status_code == 200
        assert r.json() is None

        # cleanup: soft-delete the folder
        api.delete(f"{BASE_URL}/api/folders/{fid}", headers=tester["headers"])
