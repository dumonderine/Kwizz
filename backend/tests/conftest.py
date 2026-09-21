import os, uuid, requests, pytest
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://flashcard-pro-70.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def user_session(api_client):
    """Register a fresh user and complete onboarding (Médecine)."""
    email = f"TEST_{uuid.uuid4().hex[:10]}@kwizz.fr"
    password = "secret123"
    r = api_client.post(f"{BASE_URL}/api/auth/register",
                        json={"email": email, "password": password, "name": "Test User"})
    assert r.status_code == 200, r.text
    data = r.json()
    token = data["token"]
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    # Onboarding
    r2 = requests.patch(f"{BASE_URL}/api/auth/profile",
                        json={"study_field": "Médecine"}, headers=headers)
    assert r2.status_code == 200, r2.text
    return {"email": email, "password": password, "token": token, "headers": headers,
            "user": data["user"]}
