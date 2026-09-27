#!/usr/bin/env python3
"""
session_alerts.py — Notifie 5 minutes avant l'ouverture de chaque session FX
suivie par l'app (Tokyo 00:00 UTC, Londres 08:00 UTC, New York 13:00 UTC —
mêmes horaires que SESSION_WINDOWS côté front, src/pages/HomePage.jsx), pour
avoir le temps de se préparer avant que la session n'ouvre réellement.

Même pattern de dédoublonnage que alerte_pre_cloture.py : une seule alerte
par session et par jour d'ouverture RÉEL (pas le jour "actuel" — voir
_next_open, qui gère le passage de minuit pour Tokyo : à 23h55 la prochaine
ouverture est le lendemain, pas "aujourd'hui à 00:00" déjà passé), marqueur
chargé une seule fois depuis Firestore au démarrage puis gardé en mémoire —
rien d'autre que ce script n'écrit alerts/session_{clé}_open.

Appelé à chaque tour de la boucle principale (mt5_status.py). Purement basé
sur l'horloge UTC du VPS — pas besoin de MT5 ici, contrairement à
alerte_pre_cloture.py (qui a besoin d'un tick live pour l'heure bougie).
"""

from datetime import datetime, timedelta, timezone

from notify import notify

WARNING_MINUTES_BEFORE_OPEN = 5

# clé, libellé, heure d'ouverture UTC — mêmes horaires que SESSION_WINDOWS
# (src/pages/HomePage.jsx), à garder cohérents si ce fichier change un jour.
SESSIONS = [
    {"key": "tokyo", "label": "Tokyo", "open_hour": 0},
    {"key": "london", "label": "Londres", "open_hour": 8},
    {"key": "new_york", "label": "New York", "open_hour": 13},
]

_last_alerted_date = {}
_alert_state_loaded = False


def _load_alert_state(db):
    """Restaure le dédoublonnage depuis Firestore, une seule fois au
    démarrage — pour ne pas re-notifier si le process redémarre en pleine
    fenêtre d'alerte."""
    global _alert_state_loaded
    for session in SESSIONS:
        doc = db.collection("alerts").document(f"session_{session['key']}_open").get()
        if doc.exists:
            _last_alerted_date[session["key"]] = doc.to_dict().get("last_alerted_date")
    _alert_state_loaded = True


def _next_open(now, open_hour):
    """Date/heure UTC de la PROCHAINE ouverture à `open_hour`, à partir de
    `now`, et le nombre de secondes qui nous en séparent — gère le passage
    de minuit (Tokyo, open_hour=0) via un modulo 24h plutôt qu'un simple
    now.replace(hour=...), qui donnerait une heure déjà passée."""
    seconds_since_midnight = now.hour * 3600 + now.minute * 60 + now.second
    open_seconds = open_hour * 3600
    diff = (open_seconds - seconds_since_midnight) % 86400
    return now + timedelta(seconds=diff), diff


def check_session_alerts(db):
    """Point d'entrée appelé depuis la boucle de mt5_status.py — même pattern
    que check_pre_close_alerts(db) dans alerte_pre_cloture.py."""
    if not _alert_state_loaded:
        _load_alert_state(db)

    now = datetime.now(timezone.utc)

    for session in SESSIONS:
        open_time, seconds_to_open = _next_open(now, session["open_hour"])
        if open_time.weekday() >= 5:  # samedi/dimanche — marché fermé, pas d'ouverture ce jour-là
            continue

        target_date = open_time.date().isoformat()
        in_window = seconds_to_open <= WARNING_MINUTES_BEFORE_OPEN * 60
        already_alerted = _last_alerted_date.get(session["key"]) == target_date

        if in_window and not already_alerted:
            minutes_left = round(seconds_to_open / 60)
            notify(
                f"Session de {session['label']} — ouverture dans {minutes_left} min",
                f"La session de {session['label']} ouvre à {session['open_hour']:02d}h00 UTC.",
            )
            db.collection("alerts").document(f"session_{session['key']}_open").set(
                {
                    "last_alerted_date": target_date,
                    "updated_at": now,
                }
            )
            _last_alerted_date[session["key"]] = target_date
            print(f"[OK][SESSION] Alerte {session['label']} envoyée, ouverture dans {minutes_left} min")


if __name__ == "__main__":
    from google.cloud import firestore

    from config import SA_PATH

    _db = firestore.Client.from_service_account_json(SA_PATH)
    check_session_alerts(_db)
