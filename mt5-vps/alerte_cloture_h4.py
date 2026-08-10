#!/usr/bin/env python3
"""
alerte_cloture_h4.py — Notifie à chaque nouvelle clôture de bougie H4 sur
USDJPY, pour avoir le réflexe d'aller vérifier les setups (structure D1,
confirmation H4, setup H1 — scripts 05/06/07).

Détection par comparaison au dernier close déjà notifié (stocké dans
Firestore) plutôt que sur une heure fixe devinée — la grille H4 réelle
dépend du fuseau horaire du serveur du broker, qu'on ne connaît pas
précisément. Pensé pour tourner souvent (ex. toutes les 15 min) : sans
effet si aucune nouvelle bougie n'a clôturé depuis le dernier passage.
"""

from datetime import datetime, timezone

from google.cloud import firestore

from config import PRICE_SYMBOL, SA_PATH
from mt5_client import ensure_mt5
from notify import notify

db = firestore.Client.from_service_account_json(SA_PATH)


def get_last_closed_h4(m, symbol):
    # Position 0 = bougie en cours (pas encore clôturée) ; position 1 =
    # dernière bougie réellement terminée.
    m.symbol_select(symbol, True)
    rates = m.copy_rates_from_pos(symbol, m.TIMEFRAME_H4, 1, 1)
    if rates is None or len(rates) == 0:
        raise RuntimeError(f"Aucune bougie H4 reçue pour {symbol}")
    return rates[0]


if __name__ == "__main__":
    m = ensure_mt5()
    if m is None:
        raise SystemExit("[ERREUR] Connexion MT5 indisponible.")

    candle = get_last_closed_h4(m, PRICE_SYMBOL)
    candle_time = int(candle["time"])

    doc_ref = db.collection("alerts").document("h4_close")
    doc = doc_ref.get()
    last_alerted = doc.to_dict().get("last_candle_time") if doc.exists else None

    if last_alerted == candle_time:
        print("[SKIP] Déjà notifié pour cette bougie H4.")
    else:
        close = float(candle["close"])
        open_ = float(candle["open"])
        sens = "haussière" if close >= open_ else "baissière"
        notify(
            "USDJPY — clôture H4",
            f"Nouvelle bougie H4 {sens}, clôture {close}. Va vérifier les setups.",
        )
        doc_ref.set({
            "last_candle_time": candle_time,
            "updated_at": datetime.now(timezone.utc),
        })
        print(f"[OK] Alerte envoyée pour la bougie H4 de {candle_time}")
