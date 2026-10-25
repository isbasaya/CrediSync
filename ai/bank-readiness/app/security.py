"""
Service-to-service authentication for the scorer.

Only the API gateway may call /score. It sends the shared secret in
X-Internal-Token (INTERNAL_SERVICE_TOKEN). Outside development and test
the secret is required at start-up, mirroring @credisync/config in the
TypeScript services.
"""
import hmac
import os

from fastapi import Header, HTTPException

_DEV_TOKEN = "credisync-dev-internal-token-not-for-production"
_LOCAL_ENVS = {"development", "test"}


def _environment() -> str:
    return os.environ.get("NODE_ENV") or os.environ.get("APP_ENV") or "development"


def internal_service_token() -> str:
    token = os.environ.get("INTERNAL_SERVICE_TOKEN")
    if token:
        if _environment() not in _LOCAL_ENVS and len(token) < 32:
            raise RuntimeError("INTERNAL_SERVICE_TOKEN must be at least 32 characters outside development")
        return token
    if _environment() not in _LOCAL_ENVS:
        raise RuntimeError(f"INTERNAL_SERVICE_TOKEN is required when NODE_ENV={_environment()}")
    return _DEV_TOKEN


def require_internal_token(x_internal_token: str | None = Header(default=None)) -> None:
    if not x_internal_token or not hmac.compare_digest(x_internal_token, internal_service_token()):
        raise HTTPException(status_code=401, detail="unauthorized_service")
