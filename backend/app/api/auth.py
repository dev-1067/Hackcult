from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import User
from app.ratelimit import limit
from app.schemas import LoginIn, PasswordIn, ProfileIn, RefreshIn, RegisterIn
from app.security import current_user, decode, hash_password, issue_tokens, verify_password
from app.serializers import user_out
from app.services import audit

router = APIRouter(prefix="/auth", tags=["auth"])

# A real hash to compare against when the email is unknown, so response time does not reveal accounts.
_DUMMY_HASH = hash_password("timing-equaliser-not-a-password")


@router.post("/register", status_code=201, dependencies=[Depends(limit("auth", 20))])
def register(body: RegisterIn, db: Session = Depends(get_db)):
    if db.scalar(select(User).where(User.email == body.email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists")
    user = User(email=body.email, name=body.name, password_hash=hash_password(body.password), role="contributor")
    db.add(user)
    db.flush()
    audit.record(db, user.id, "auth.register", "user", user.id)
    db.commit()
    return {"user": user_out(user), **issue_tokens(user)}


@router.post("/login", dependencies=[Depends(limit("auth", 20))])
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email))
    ok = verify_password(user.password_hash if user else _DUMMY_HASH, body.password)
    if not user or not ok:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect email or password")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account has been disabled")
    audit.record(db, user.id, "auth.login", "user", user.id)
    db.commit()
    return {"user": user_out(user), **issue_tokens(user)}


@router.post("/refresh")
def refresh(body: RefreshIn, db: Session = Depends(get_db)):
    payload = decode(body.refresh_token, "refresh")
    user = db.get(User, payload["sub"])
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account not found or disabled")
    return {"user": user_out(user), **issue_tokens(user)}


@router.get("/me")
def me(user: User = Depends(current_user)):
    return user_out(user)


@router.patch("/me")
def update_me(body: ProfileIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    user = db.merge(user)
    user.name = " ".join(body.name.split())
    db.commit()
    return user_out(user)


@router.post("/password")
def change_password(body: PasswordIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    user = db.merge(user)
    if not verify_password(user.password_hash, body.current_password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
    user.password_hash = hash_password(body.new_password)
    audit.record(db, user.id, "auth.password_changed", "user", user.id)
    db.commit()
    return {"ok": True}
