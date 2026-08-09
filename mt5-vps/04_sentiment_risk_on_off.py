#!/usr/bin/env python3
"""
Question 4 — Quel est le sentiment risk-on/risk-off global ?

Combine 2 signaux bruts (niveau du VIX, variation du S&P 500 sur 5 jours de
bourse) en un sentiment simple, par règle — pas de jugement LLM. Réutilise
FRED_API_KEY déjà en place, aucune nouvelle clé nécessaire.
"""

from datetime import datetime, timezone

import requests
from google.cloud import firestore

from config import FRED_API_KEY, SA_PATH

db = firestore.Client.from_service_account_json(SA_PATH)

# Repères classiques risk-on/risk-off — à remettre à jour toi-même selon le
# contexte de marché, ce ne sont pas des vérités figées.
VIX_RISK_OFF_THRESHOLD = 20.0  # au-dessus : volatilité élevée, risk-off
VIX_CALM_THRESHOLD = 15.0  # en dessous : marché calme, risk-on
SP500_MOVE_THRESHOLD_PCT = 2.0  # variation sur 5 jours jugée significative


def get_fred_series(series_id, limit=8):
    r = requests.get("https://api.stlouisfed.org/fred/series/observations", params={
        "series_id": series_id, "api_key": FRED_API_KEY,
        "file_type": "json", "sort_order": "desc", "limit": limit,
    })
    r.raise_for_status()
    obs = r.json()["observations"]
    # FRED renvoie "." les jours sans donnée (marché fermé) — on les ignore.
    return [float(o["value"]) for o in obs if o["value"] != "."]


if __name__ == "__main__":
    vix_actuel = get_fred_series("VIXCLS")[0]

    sp500_values = get_fred_series("SP500")
    sp500_actuel = sp500_values[0]
    sp500_reference = sp500_values[5] if len(sp500_values) > 5 else sp500_values[-1]
    sp500_variation_5j_pct = round((sp500_actuel - sp500_reference) / sp500_reference * 100, 2)

    signal_vix_risk_off = vix_actuel >= VIX_RISK_OFF_THRESHOLD
    signal_vix_risk_on = vix_actuel <= VIX_CALM_THRESHOLD
    signal_sp500_risk_off = sp500_variation_5j_pct <= -SP500_MOVE_THRESHOLD_PCT
    signal_sp500_risk_on = sp500_variation_5j_pct >= SP500_MOVE_THRESHOLD_PCT

    risk_off_count = sum([signal_vix_risk_off, signal_sp500_risk_off])
    risk_on_count = sum([signal_vix_risk_on, signal_sp500_risk_on])

    if risk_off_count == 2:
        sentiment = "risk-off"
    elif risk_on_count == 2:
        sentiment = "risk-on"
    else:
        sentiment = "neutre"

    data = {
        "vix": vix_actuel,
        "sp500_variation_5j_pct": sp500_variation_5j_pct,
        "seuil_vix_risk_off": VIX_RISK_OFF_THRESHOLD,
        "seuil_vix_calme": VIX_CALM_THRESHOLD,
        "sentiment": sentiment,
        "updated_at": datetime.now(timezone.utc),
    }

    db.collection("daily_questions").document("04_sentiment_risk_on_off").set(data)
    print("Écrit dans Firestore avec succès :")
    print(data)
