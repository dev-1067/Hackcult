import os
import tempfile
from pathlib import Path

import pytest

# Isolated database and storage for the whole test session (set before the app is imported).
_TMP = Path(tempfile.mkdtemp(prefix="lipisetu-test-"))
os.environ["DATABASE_URL"] = f"sqlite:///{(_TMP / 'test.db').as_posix()}"
os.environ["STORAGE_DIR"] = str(_TMP / "storage")
os.environ["EMBEDDED_WORKER"] = "true"
os.environ["WORKER_POLL_SECONDS"] = "0.2"
os.environ["RATE_LIMIT_PER_MINUTE"] = "10000"
os.environ["ANTHROPIC_API_KEY"] = ""
os.environ["OSRM_URL"] = "http://127.0.0.1:9"  # unreachable -> exercises the straight-line fallback


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c


def _account(client, email: str, role: str) -> dict:
    from app.db import SessionLocal
    from app.models import User

    r = client.post("/api/v1/auth/register", json={"name": role.title() + " Tester", "email": email, "password": "testpass123"})
    assert r.status_code in (201, 409), r.text
    if role != "contributor":
        with SessionLocal() as db:
            u = db.query(User).filter_by(email=email).one()
            u.role = role
            db.commit()
    r = client.post("/api/v1/auth/login", json={"email": email, "password": "testpass123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="session")
def contributor(client):
    return _account(client, "contrib@test.in", "contributor")


@pytest.fixture(scope="session")
def curator(client):
    return _account(client, "curator@test.in", "curator")


@pytest.fixture(scope="session")
def viewer(client):
    return _account(client, "viewer@test.in", "viewer")


@pytest.fixture(scope="session")
def admin(client):
    return _account(client, "admin@test.in", "admin")
