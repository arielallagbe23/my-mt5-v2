#!/usr/bin/env python3
"""
Question 6 — Le H4 confirme-t-il le biais D1 ?

Recalcule la tendance D1 et H4 (même méthode que 05_structure_d1.py — MM20
vs MM50) et vérifie si elles pointent dans le même sens. Autonome : ne lit
pas le résultat du script 05, recalcule tout depuis MT5 pour éviter toute
dépendance d'ordre d'exécution entre scripts.

Comme le script 05, celui-ci a besoin du terminal MT5 ouvert et connecté.
"""

from datetime import datetime, timezone

from google.cloud import firestore

from config import PRICE_SYMBOL, SA_PATH
from mt5_client import ensure_mt5

db = firestore.Client.from_service_account_json(SA_PATH)

SMA_SHORT = 20
SMA_LONG = 50


def get_candles(m, symbol, timeframe, count):
    m.symbol_select(symbol, True)
    rates = m.copy_rates_from_pos(symbol, timeframe, 0, count)
    if rates is None or len(rates) == 0:
        raise RuntimeError(f"Aucune bougie reçue pour {symbol}")
    return rates


def sma(values, period):
    return sum(values[-period:]) / period


def compute_trend(closes):
    prix_actuel = closes[-1]
    sma20 = sma(closes, SMA_SHORT)
    sma50 = sma(closes, SMA_LONG)
    if prix_actuel > sma20 and prix_actuel > sma50 and sma20 > sma50:
        return "haussière"
    if prix_actuel < sma20 and prix_actuel < sma50 and sma20 < sma50:
        return "baissière"
    return "range"


if __name__ == "__main__":
    m = ensure_mt5()
    if m is None:
        raise SystemExit("[ERREUR] Connexion MT5 indisponible.")

    d1_candles = get_candles(m, PRICE_SYMBOL, m.TIMEFRAME_D1, SMA_LONG + 5)
    h4_candles = get_candles(m, PRICE_SYMBOL, m.TIMEFRAME_H4, SMA_LONG + 5)

    tendance_d1 = compute_trend([float(c["close"]) for c in d1_candles])
    tendance_h4 = compute_trend([float(c["close"]) for c in h4_candles])

    if tendance_d1 == "range" or tendance_h4 == "range":
        confirmation = "indéterminée"
    elif tendance_d1 == tendance_h4:
        confirmation = "confirmé"
    else:
        confirmation = "divergent"

    data = {
        "tendance_d1": tendance_d1,
        "tendance_h4": tendance_h4,
        "confirmation": confirmation,
        "updated_at": datetime.now(timezone.utc),
    }

    db.collection("daily_questions").document("06_confirmation_h4").set(data)
    print("Écrit dans Firestore avec succès :")
    print(data)
