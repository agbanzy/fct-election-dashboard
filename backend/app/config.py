"""Env-driven config. Strict by design — every consumed env var lives here."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class Config:
    env: Literal["development", "production", "test"]
    log_level: str
    database_url: str
    irev_api_base: str
    irev_api_key: str | None
    scraper_enabled: bool
    scraper_default_state_id: int
    scraper_interval_live_seconds: int
    scraper_interval_preflight_seconds: int
    scraper_interval_idle_seconds: int
    scraper_preflight_window_hours: int
    # How many days after polls close we keep syncing at live cadence. INEC
    # uploads result forms for days, so a short tail drops us to a 24h sleep
    # while collation is still in flight.
    scraper_live_trailing_days: int
    # Burst multiplier — multiplies per-tick API budget AND shortens the
    # idle sleep cycle. Defaults to 1.0 (polite). Set to 4-5 for full sync.
    scraper_burst_factor: float
    cors_origins: str
    # Free API, but by application: gate /api/* reads behind issued keys
    # (dashboard same-origin traffic always passes). Defaults on in
    # production, off elsewhere; override with API_KEY_ENFORCEMENT.
    api_key_enforcement: bool

    @classmethod
    def from_env(cls) -> Config:
        env = os.environ.get("ENV", "development")
        enforcement_raw = os.environ.get("API_KEY_ENFORCEMENT", "")
        return cls(
            env=env,  # type: ignore[arg-type]
            log_level=os.environ.get("LOG_LEVEL", "INFO"),
            database_url=os.environ.get(
                "DATABASE_URL",
                "postgresql+psycopg://postgres:postgres@localhost:5432/elections",
            ),
            irev_api_base=os.environ.get(
                "IREV_API_BASE", "https://dolphin-app-sleqh.ondigitalocean.app/api/v1"
            ),
            # INEC ships a public Angular client key in their SPA — not a secret.
            # IrevClient falls back to that constant when IREV_API_KEY is unset.
            irev_api_key=os.environ.get("IREV_API_KEY") or None,
            scraper_enabled=os.environ.get("SCRAPER_ENABLED", "true").lower() == "true",
            scraper_default_state_id=int(os.environ.get("SCRAPER_DEFAULT_STATE_ID", "15")),
            scraper_interval_live_seconds=int(os.environ.get("SCRAPER_INTERVAL_LIVE", "120")),
            scraper_interval_preflight_seconds=int(
                os.environ.get("SCRAPER_INTERVAL_PREFLIGHT", "300")
            ),
            scraper_interval_idle_seconds=int(os.environ.get("SCRAPER_INTERVAL_IDLE", "86400")),
            scraper_preflight_window_hours=int(
                os.environ.get("SCRAPER_PREFLIGHT_WINDOW_HOURS", "6")
            ),
            scraper_live_trailing_days=int(
                os.environ.get("SCRAPER_LIVE_TRAILING_DAYS", "3")
            ),
            scraper_burst_factor=float(os.environ.get("SCRAPER_BURST_FACTOR", "1.0")),
            cors_origins=os.environ.get("CORS_ORIGINS", "*"),
            api_key_enforcement=(
                enforcement_raw.lower() == "true" if enforcement_raw else env == "production"
            ),
        )


def normalize_database_url(url: str) -> str:
    """DO App Platform binds DATABASE_URL as `postgres://`; SQLAlchemy 2 wants `postgresql+psycopg://`."""
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url[len("postgres://") :]
    if url.startswith("postgresql://") and "+psycopg" not in url:
        return "postgresql+psycopg://" + url[len("postgresql://") :]
    return url
