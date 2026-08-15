"""One-shot seed script — runs as the POST_DEPLOY job on DO App Platform.

Idempotent. Inserts states, default parties, and known election calendar entries.
Re-running is safe; existing rows are left untouched.
"""

from __future__ import annotations

import logging
from datetime import date

from sqlalchemy import select

from app.config import Config
from app.db import init_engine, session_scope
from app.models import ElectionCalendar, Party, State

log = logging.getLogger(__name__)


# Nigeria's 36 states + FCT. state_id mirrors INEC IReV's numeric IDs where
# known; for ones we haven't yet confirmed against IReV, we use the
# alphabetical ordinal. Phase B verifies + corrects against IReV.
STATES: list[tuple[int, str, str, str]] = [
    (1, "AB", "Abia", "SE"),
    (2, "AD", "Adamawa", "NE"),
    (3, "AK", "Akwa Ibom", "SS"),
    (4, "AN", "Anambra", "SE"),
    (5, "BA", "Bauchi", "NE"),
    (6, "BY", "Bayelsa", "SS"),
    (7, "BE", "Benue", "NC"),
    (8, "BO", "Borno", "NE"),
    (9, "CR", "Cross River", "SS"),
    (10, "DE", "Delta", "SS"),
    (11, "EB", "Ebonyi", "SE"),
    (12, "ED", "Edo", "SS"),
    (13, "EK", "Ekiti", "SW"),
    (14, "EN", "Enugu", "SE"),
    (15, "FC", "FCT", "NC"),
    (16, "GO", "Gombe", "NE"),
    (17, "IM", "Imo", "SE"),
    (18, "JI", "Jigawa", "NW"),
    (19, "KD", "Kaduna", "NW"),
    (20, "KN", "Kano", "NW"),
    (21, "KT", "Katsina", "NW"),
    (22, "KE", "Kebbi", "NW"),
    (23, "KO", "Kogi", "NC"),
    (24, "KW", "Kwara", "NC"),
    (25, "LA", "Lagos", "SW"),
    (26, "NA", "Nasarawa", "NC"),
    (27, "NI", "Niger", "NC"),
    (28, "OG", "Ogun", "SW"),
    (29, "ON", "Ondo", "SW"),
    (30, "OS", "Osun", "SW"),
    (31, "OY", "Oyo", "SW"),
    (32, "PL", "Plateau", "NC"),
    (33, "RI", "Rivers", "SS"),
    (34, "SO", "Sokoto", "NW"),
    (35, "TA", "Taraba", "NE"),
    (36, "YO", "Yobe", "NE"),
    (37, "ZA", "Zamfara", "NW"),
]


PARTIES: list[tuple[str, str, str | None, int | None]] = [
    ("APC", "All Progressives Congress", "#00A859", 2013),
    ("PDP", "Peoples Democratic Party", "#D72027", 1998),
    ("LP", "Labour Party", "#A00000", 2002),
    ("NNPP", "New Nigeria Peoples Party", "#0050A0", 2002),
    ("APGA", "All Progressives Grand Alliance", "#FBC02D", 2003),
    ("ADC", "African Democratic Congress", "#1B5E20", 2005),
    ("YPP", "Young Progressives Party", "#7B1FA2", 2017),
    ("ADP", "Action Democratic Party", "#0288D1", 2017),
    ("SDP", "Social Democratic Party", "#7E57C2", 1998),
    ("CPC", "Congress for Progressive Change", "#000000", 2009),
    ("ACN", "Action Congress of Nigeria", "#FFA000", 2006),
    ("ANPP", "All Nigeria Peoples Party", "#1A237E", 1999),
    ("AD", "Alliance for Democracy", "#388E3C", 1998),
]


# Bootstrap hints only. `sync.reconcile_calendar()` re-derives these from the
# elections IReV actually publishes on every daemon iteration, so a wrong date
# here self-corrects rather than idling the scraper through polling day (which
# is exactly what the old Osun 2026-07-11 entry did — INEC polled 2026-08-15).
CALENDAR: list[tuple[date, str, int | None, str, str | None]] = [
    (date(2026, 6, 20), "governorship", 13, "scheduled", "Ekiti gubernatorial 2026"),
    (date(2026, 8, 15), "governorship", 30, "scheduled", "Osun gubernatorial 2026"),
    (date(2027, 2, 25), "presidential", None, "scheduled", "Presidential 2027 (provisional)"),
    (date(2027, 2, 25), "senate", None, "scheduled", "Senate 2027 (provisional)"),
    (date(2027, 2, 25), "reps", None, "scheduled", "House of Reps 2027 (provisional)"),
    (date(2027, 3, 11), "governorship", None, "scheduled", "Off-cycle Gov + State HoA 2027 (provisional)"),
    (date(2027, 3, 11), "state_hoa", None, "scheduled", "State HoA 2027 (provisional)"),
]


def seed() -> None:
    cfg = Config.from_env()
    init_engine(cfg.database_url)
    logging.basicConfig(level=getattr(logging, cfg.log_level.upper(), logging.INFO))

    with session_scope() as session:
        existing_states = {s.state_id for s in session.scalars(select(State))}
        for state_id, code, name, zone in STATES:
            if state_id in existing_states:
                continue
            session.add(State(state_id=state_id, code=code, name=name, zone=zone))
        session.flush()  # FK: election_calendar.state_id needs states present
        log.info("seeded states (added %d new)", len(STATES) - len(existing_states))

        existing_parties = {
            (p.code, p.active_from) for p in session.scalars(select(Party))
        }
        for code, name, color, active_from in PARTIES:
            if (code, active_from) in existing_parties:
                continue
            session.add(Party(code=code, name=name, color_hex=color, active_from=active_from))
        session.flush()
        log.info("seeded parties")

        existing_cal = {
            (c.election_date, c.election_type, c.state_id)
            for c in session.scalars(select(ElectionCalendar))
        }
        for d, etype, state_id, status, notes in CALENDAR:
            if (d, etype, state_id) in existing_cal:
                continue
            session.add(
                ElectionCalendar(
                    election_date=d,
                    election_type=etype,
                    state_id=state_id,
                    status=status,
                    notes=notes,
                )
            )
        log.info("seeded calendar")


if __name__ == "__main__":
    seed()
