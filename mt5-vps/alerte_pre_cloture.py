#!/usr/bin/env python3
"""
alerte_pre_cloture.py — Alerte ~10 minutes avant la clôture des bougies H1
et H4 sur USDJPY, pour avoir le temps de regarder la situation et
éventuellement préparer une tâche avant que la bougie ne clôture réellement.

Calcule l'heure de clôture ATTENDUE de la bougie en cours (heure d'ouverture
+ durée du timeframe) plutôt que de deviner une heure fixe. IMPORTANT :
candle["time"] renvoyé par l'API MT5 est exprimé dans l'heure SERVEUR du
broker (ex: FTMO tourne en GMT+3 l'été, GMT+2 l'hiver), pas en UTC réel —
piège classique de l'API. On calcule le décalage en direct via un tick live
(_broker_offset_seconds) plutôt que de coder un décalage en dur, qui
casserait au changement d'heure (le nôtre ou celui du broker, pas forcément
synchronisés). Appelé à chaque tour de la boucle principale (mt5_status.py,
toutes les POLL_INTERVAL secondes) : la fenêtre d'alerte fait 10 minutes de
large, donc largement de quoi retomber dedans avant qu'elle ne se referme,
et le dédoublonnage Firestore (last_candle_open) garantit une seule notif
par bougie.
"""

from datetime import datetime, timezone

from config import PRICE_SYMBOL
from mt5_client import ensure_mt5
from notify import notify

WARNING_MINUTES_BEFORE_CLOSE = 10

TIMEFRAMES = {
    "H1": 3600,
    "H4": 14400,
}


def _enabled_timeframes(db):
    """Lit settings/alerts (réglé depuis la page Profil de l'app) — les deux
    timeframes sont actives par défaut si le doc n'existe pas encore."""
    doc = db.collection("settings").document("alerts").get()
    data = doc.to_dict() if doc.exists else {}
    return {"H1": data.get("h1", True), "H4": data.get("h4", True)}


def _broker_offset_seconds(m, symbol):
    """Écart entre l'heure "UTC" mensongère de l'API MT5 (en réalité l'heure
    serveur du broker) et l'heure UTC réelle, mesuré en direct sur un tick
    live — pas de fuseau codé en dur, ça reste correct même après un
    changement d'heure d'été/hiver (le nôtre ou celui du broker)."""
    tick = m.symbol_info_tick(symbol)
    if tick is None:
        return 0
    return int(tick.time) - int(datetime.now(timezone.utc).timestamp())


def check_pre_close_alerts(db):
    """Point d'entrée appelé depuis la boucle de mt5_status.py — même pattern
    que check_due_tasks(db) dans tasks.py. Sans effet si MT5 est
    temporairement indisponible (retenté au tour de boucle suivant)."""
    m = ensure_mt5()
    if m is None:
        return
    enabled = _enabled_timeframes(db)
    broker_offset = _broker_offset_seconds(m, PRICE_SYMBOL)
    for label, duration_seconds in TIMEFRAMES.items():
        if not enabled.get(label, True):
            continue
        check_timeframe(db, m, PRICE_SYMBOL, label, duration_seconds, broker_offset)


def check_timeframe(db, m, symbol, label, duration_seconds, broker_offset):
    m.symbol_select(symbol, True)
    rates = m.copy_rates_from_pos(symbol, getattr(m, f"TIMEFRAME_{label}"), 0, 1)
    if rates is None or len(rates) == 0:
        print(f"[{label}] Aucune bougie reçue, ignoré.")
        return

    candle = rates[0]
    open_time_broker = int(candle["time"])  # heure serveur broker, pas UTC
    close_time_utc = open_time_broker + duration_seconds - broker_offset
    now_utc = int(datetime.now(timezone.utc).timestamp())
    seconds_to_close = close_time_utc - now_utc

    doc_ref = db.collection("alerts").document(f"pre_close_{label.lower()}")
    doc = doc_ref.get()
    last_alerted_open = doc.to_dict().get("last_candle_open") if doc.exists else None

    in_window = 0 <= seconds_to_close <= WARNING_MINUTES_BEFORE_CLOSE * 60
    already_alerted = last_alerted_open == open_time_broker

    if in_window and not already_alerted:
        minutes_left = round(seconds_to_close / 60)
        notify(
            f"USDJPY — {label} clôture dans {minutes_left} min",
            "Vérifie la situation, prépare une tâche si besoin.",
        )
        doc_ref.set({
            "last_candle_open": open_time_broker,
            "updated_at": datetime.now(timezone.utc),
        })
        print(f"[OK][{label}] Alerte envoyée, clôture dans {minutes_left} min")
    else:
        # DIAGNOSTIC temporaire : à retirer une fois le comportement confirmé
        # en conditions réelles.
        close_str = datetime.fromtimestamp(close_time_utc, tz=timezone.utc).strftime("%H:%M")
        now_str = datetime.fromtimestamp(now_utc, tz=timezone.utc).strftime("%H:%M")
        print(
            f"[SKIP][{label}] fenêtre={in_window} déjà_alerté={already_alerted} "
            f"clôture_UTC={close_str} maintenant_UTC={now_str} reste={seconds_to_close // 60}min "
            f"décalage_broker={broker_offset / 3600:.1f}h"
        )


if __name__ == "__main__":
    from google.cloud import firestore

    from config import SA_PATH

    _db = firestore.Client.from_service_account_json(SA_PATH)
    check_pre_close_alerts(_db)
