from sqlalchemy.orm import Session

from app.models import AuditLog


def record(db: Session, user_id: str | None, action: str, entity: str, entity_id: str = "", **detail) -> None:
    """Append an audit entry in the caller's transaction."""
    db.add(AuditLog(user_id=user_id, action=action, entity=entity, entity_id=entity_id, detail=detail))
