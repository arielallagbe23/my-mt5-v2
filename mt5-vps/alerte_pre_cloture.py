#!/usr/bin/env python3
"""
alerte_pre_cloture.py — Alerte ~10 minutes avant la clôture des bougies H1
et H4 sur USDJPY, pour avoir le temps de regarder la situation et
éventuellement préparer une tâche avant que la bougie ne clôture réellement.

Calcule l'heure de clôture ATTENDUE de la bougie en cours (heure d'ouverture
+ durée du timeframe) plutôt que de deviner une heure fixe — la grille
réelle dépend du fuseau horaire du serveur du broker. Pensé pour tourner
toutes les 5 minutes : la fenêtre d'alerte fait 10 minutes de large, donc au
moins un passage tombe dedans à chaque fois.
"""

from datetime import datetime, timezone

from google.cloud import firestore

from config import PRICE_SYMBOL, SA_PATH
from mt5_client import ensure_mt5
from notify import notify

db = firestore.Client.from_service_account_json(SA_PATH)

WARNING_MINUTES_BEFORE_CLOSE = 10

TIMEFRAMES = {
    "H1": 3600,
    "H4": 14400,
}


def check_timeframe(m, symbol, label, duration_seconds):
    m.symbol_select(symbol, True)
    rates = m.copy_rates_from_pos(symbol, getattr(m, f"TIMEFRAME_{label}"), 0, 1)
    if rates is None or len(rates) == 0:
        print(f"[{label}] Aucune bougie reçue, ignoré.")
        return

    candle = rates[0]
    open_time = int(candle["time"])
    close_time = open_time + duration_seconds
    now = int(datetime.now(timezone.utc).timestamp())
    seconds_to_close = close_time - now

    doc_ref = db.collection("alerts").document(f"pre_close_{label.lower()}")
    doc = doc_ref.get()
    last_alerted_open = doc.to_dict().get("last_candle_open") if doc.exists else None

    in_window = 0 <= seconds_to_close <= WARNING_MINUTES_BEFORE_CLOSE * 60
    already_alerted = last_alerted_open == open_time

    if in_window and not already_alerted:
        minutes_left = round(seconds_to_close / 60)
        notify(
            f"USDJPY — {label} clôture dans {minutes_left} min",
            "Vérifie la situation, prépare une tâche si besoin.",
        )
        doc_ref.set({
            "last_candle_open": open_time,
            "updated_at": datetime.now(timezone.utc),
        })
        print(f"[OK][{label}] Alerte envoyée, clôture dans {minutes_left} min")
    else:
        print(f"[SKIP][{label}] fenêtre={in_window} déjà_alerté={already_alerted}")


if __name__ == "__main__":
    m = ensure_mt5()
    if m is None:
        raise SystemExit("[ERREUR] Connexion MT5 indisponible.")

    for label, duration_seconds in TIMEFRAMES.items():
        check_timeframe(m, PRICE_SYMBOL, label, duration_seconds)
