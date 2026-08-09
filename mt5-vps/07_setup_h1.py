#!/usr/bin/env python3
"""
Question 7 — Quel setup d'entrée sur H1 ?

Signal technique objectif : tendance H1 (MM20 vs MM50), pullback du prix vers
la MM20 H1, et RSI H1 qui sort de survente/surachat. Autonome, recalcule tout
depuis MT5 — même dépendance que les scripts 05/06 (terminal MT5 connecté).
"""

from datetime import datetime, timezone

from google.cloud import firestore

from config import PRICE_SYMBOL, SA_PATH
from mt5_client import ensure_mt5

db = firestore.Client.from_service_account_json(SA_PATH)

SMA_SHORT = 20
SMA_LONG = 50
RSI_PERIOD = 14
PULLBACK_TOLERANCE_PCT = 0.15  # distance à la MM20 jugée "proche" (pullback) — à ajuster
RSI_OVERSOLD = 30
RSI_OVERBOUGHT = 70


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


def compute_rsi(closes, period=RSI_PERIOD):
    gains, losses = [], []
    for i in range(1, len(closes)):
        change = closes[i] - closes[i - 1]
        gains.append(max(change, 0))
        losses.append(max(-change, 0))
    avg_gain = sma(gains, period)
    avg_loss = sma(losses, period)
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100 - (100 / (1 + rs)), 2)


if __name__ == "__main__":
    m = ensure_mt5()
    if m is None:
        raise SystemExit("[ERREUR] Connexion MT5 indisponible.")

    h1_candles = get_candles(m, PRICE_SYMBOL, m.TIMEFRAME_H1, SMA_LONG + RSI_PERIOD + 5)
    closes = [float(c["close"]) for c in h1_candles]

    prix_actuel = closes[-1]
    mm20_h1 = sma(closes, SMA_SHORT)
    tendance_h1 = compute_trend(closes)
    rsi_h1 = compute_rsi(closes)
    rsi_precedent = compute_rsi(closes[:-1])

    distance_mm20_pct = round(abs(prix_actuel - mm20_h1) / mm20_h1 * 100, 3)
    pullback_mm20 = distance_mm20_pct <= PULLBACK_TOLERANCE_PCT

    # "Sortie" = franchissement du seuil entre la bougie précédente et l'actuelle,
    # pas juste "en dessous/au-dessus" (sinon le signal resterait actif en continu).
    sortie_survente = rsi_precedent < RSI_OVERSOLD <= rsi_h1
    sortie_surachat = rsi_precedent > RSI_OVERBOUGHT >= rsi_h1

    if tendance_h1 == "haussière" and pullback_mm20 and sortie_survente:
        setup = "achat"
    elif tendance_h1 == "baissière" and pullback_mm20 and sortie_surachat:
        setup = "vente"
    else:
        setup = "aucun"

    data = {
        "tendance_h1": tendance_h1,
        "prix_actuel": round(prix_actuel, 3),
        "mm20_h1": round(mm20_h1, 3),
        "distance_mm20_pct": distance_mm20_pct,
        "pullback_mm20": pullback_mm20,
        "rsi_h1": rsi_h1,
        "setup": setup,
        "updated_at": datetime.now(timezone.utc),
    }

    db.collection("daily_questions").document("07_setup_h1").set(data)
    print("Écrit dans Firestore avec succès :")
    print(data)
