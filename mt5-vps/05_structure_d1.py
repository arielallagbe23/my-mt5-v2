#!/usr/bin/env python3
"""
Question 5 — Quelle est la structure D1 actuelle ?

Combine 3 signaux bruts (moyennes mobiles 20/50 jours, support/résistance sur
30 jours, biais de la dernière bougie) en une lecture simple de la structure
D1 — pas de jugement LLM. Lit les bougies D1 directement depuis MT5 (même
connexion que mt5_status.py), aucune nouvelle clé nécessaire.

Contrairement aux scripts 01-04, celui-ci a besoin du terminal MT5 ouvert et
connecté sur cette machine pour fonctionner.
"""

from datetime import datetime, timezone

from google.cloud import firestore

from config import PRICE_SYMBOL, SA_PATH
from mt5_client import ensure_mt5

db = firestore.Client.from_service_account_json(SA_PATH)

SMA_SHORT = 20
SMA_LONG = 50
RANGE_LOOKBACK = 30


def get_d1_candles(m, symbol, count):
    m.symbol_select(symbol, True)
    rates = m.copy_rates_from_pos(symbol, m.TIMEFRAME_D1, 0, count)
    if rates is None or len(rates) == 0:
        raise RuntimeError(f"Aucune bougie D1 reçue pour {symbol}")
    return rates


def sma(values, period):
    return sum(values[-period:]) / period


if __name__ == "__main__":
    m = ensure_mt5()
    if m is None:
        raise SystemExit("[ERREUR] Connexion MT5 indisponible.")

    candles = get_d1_candles(m, PRICE_SYMBOL, max(SMA_LONG, RANGE_LOOKBACK) + 5)
    closes = [float(c["close"]) for c in candles]
    highs = [float(c["high"]) for c in candles]
    lows = [float(c["low"]) for c in candles]

    prix_actuel = closes[-1]
    sma20 = round(sma(closes, SMA_SHORT), 3)
    sma50 = round(sma(closes, SMA_LONG), 3)

    if prix_actuel > sma20 and prix_actuel > sma50 and sma20 > sma50:
        tendance = "haussière"
    elif prix_actuel < sma20 and prix_actuel < sma50 and sma20 < sma50:
        tendance = "baissière"
    else:
        tendance = "range"

    resistance = round(max(highs[-RANGE_LOOKBACK:]), 3)
    support = round(min(lows[-RANGE_LOOKBACK:]), 3)

    derniere = candles[-1]
    biais_derniere_bougie = "haussière" if float(derniere["close"]) >= float(derniere["open"]) else "baissière"

    data = {
        "prix_actuel": round(prix_actuel, 3),
        "sma20": sma20,
        "sma50": sma50,
        "tendance": tendance,
        "support": support,
        "resistance": resistance,
        "biais_derniere_bougie": biais_derniere_bougie,
        "updated_at": datetime.now(timezone.utc),
    }

    db.collection("daily_questions").document("05_structure_d1").set(data)
    print("Écrit dans Firestore avec succès :")
    print(data)
