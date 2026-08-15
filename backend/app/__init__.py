"""Flask app factory for the pan-Nigeria election dashboard."""

from __future__ import annotations

import logging

from flask import Flask
from flask_cors import CORS

from app.config import Config


def create_app(config: Config | None = None) -> Flask:
    cfg = config or Config.from_env()
    app = Flask(__name__)
    app.config.from_object(cfg)

    logging.basicConfig(
        level=getattr(logging, cfg.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    # Fail safe: never boot a production web process with an unprotected admin
    # surface. The admin gate fails closed when ADMIN_TOKEN is unset, and this
    # assertion makes that unset state unreachable in production so a spec/
    # console omission surfaces as a refused deploy, not a silent open door.
    from app.admin_auth import admin_token_configured

    if cfg.env == "production" and not admin_token_configured():
        raise RuntimeError(
            "ADMIN_TOKEN must be set in production (admin write endpoints would "
            "otherwise be unauthenticated). Set it as an encrypted env var."
        )

    CORS(app, resources={r"/api/*": {"origins": cfg.cors_origins}})

    from app.ratelimit import limiter

    limiter.init_app(app)

    # Initialize DB engine lazily so importing the app for tests doesn't connect.
    from app.db import init_engine

    init_engine(cfg.database_url)

    # Register blueprints.
    from app.api import (
        admin as admin_api,
    )
    from app.api import (
        analysis as analysis_api,
    )
    from app.api import (
        auth as auth_api,
    )
    from app.api import (
        calendar as calendar_api,
    )
    from app.api import (
        candidates,
        elections,
        health,
        live,
        methodology,
        news,
        overview,
        results,
        scrape,
        states,
    )
    from app.api import (
        developer as developer_api,
    )
    from app.api import (
        sync as sync_api,
    )
    from app.api_gate import install_api_gate

    # Free-API access gate (dashboard traffic passes; programmatic access
    # needs an approved key). Runs before every request.
    install_api_gate(app, cfg)

    app.register_blueprint(developer_api.bp)
    app.register_blueprint(admin_api.bp)
    app.register_blueprint(auth_api.bp)
    app.register_blueprint(health.bp)
    app.register_blueprint(overview.bp)
    app.register_blueprint(calendar_api.bp)
    app.register_blueprint(states.bp)
    app.register_blueprint(elections.bp)
    app.register_blueprint(candidates.bp)
    app.register_blueprint(results.bp)
    app.register_blueprint(analysis_api.bp)
    app.register_blueprint(scrape.bp)
    app.register_blueprint(methodology.bp)
    app.register_blueprint(live.bp)
    app.register_blueprint(sync_api.bp)
    app.register_blueprint(news.bp)

    return app
