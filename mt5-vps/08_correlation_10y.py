#!/usr/bin/env python3
"""
Question 8 (partie corrélation) — Quelle est ma corrélation actuelle avec
le rendement du Treasury 10 ans ?

Calcule la corrélation de Pearson entre les variations quotidiennes de
USDJPY et du rendement 10 ans US, sur les ~30 derniers jours de bourse
(FRED). Réutilise FRED_API_KEY déjà en place, aucune nouvelle clé.

La partie "exposition" de la question (positions actuelles) est calculée
côté frontend à partir de positions/main, déjà chargé — pas besoin de VPS
pour ça, voir HomePage.jsx.
"""

from datetime import datetime, timezone

import requests
from google.cloud import firestore

from config import FRED_API_KEY, SA_PATH

db = firestore.Client.from_service_account_json(SA_PATH)

LOOKBACK_DAYS = 30


def get_fred_series(series_id, limit):
    r = requests.get("https://api.stlouisfed.org/fred/series/observations", params={
        "series_id": series_id, "api_key": FRED_API_KEY,
        "file_type": "json", "sort_order": "asc", "limit": limit,
    })
    r.raise_for_status()
    obs = r.json()["observations"]
    # FRED renvoie "." les jours sans donnée (marché fermé) — on les ignore.
    return {o["date"]: float(o["value"]) for o in obs if o["value"] != "."}


def daily_changes(series_by_date, dates):
    values = [series_by_date[d] for d in dates if d in series_by_date]
    return [values[i] - values[i - 1] for i in range(1, len(values))]


def pearson_correlation(x, y):
    n = min(len(x), len(y))
    x, y = x[:n], y[:n]
    if n == 0:
        return 0.0
    mean_x, mean_y = sum(x) / n, sum(y) / n
    cov = sum((x[i] - mean_x) * (y[i] - mean_y) for i in range(n))
    std_x = sum((v - mean_x) ** 2 for v in x) ** 0.5
    std_y = sum((v - mean_y) ** 2 for v in y) ** 0.5
    if std_x == 0 or std_y == 0:
        return 0.0
    return cov / (std_x * std_y)


def label_correlation(r):
    if r >= 0.7:
        return "forte positive"
    if r >= 0.3:
        return "positive"
    if r > -0.3:
        return "faible"
    if r > -0.7:
        return "négative"
    return "forte négative"


if __name__ == "__main__":
    usdjpy = get_fred_series("DEXJPUS", LOOKBACK_DAYS + 10)
    us10y = get_fred_series("DGS10", LOOKBACK_DAYS + 10)

    common_dates = sorted(set(usdjpy) & set(us10y))[-(LOOKBACK_DAYS + 1):]
    changes_usdjpy = daily_changes(usdjpy, common_dates)
    changes_us10y = daily_changes(us10y, common_dates)

    correlation = round(pearson_correlation(changes_usdjpy, changes_us10y), 2)

    data = {
        "correlation_usdjpy_10y": correlation,
        "lecture": label_correlation(correlation),
        "periode_jours": len(changes_usdjpy),
        "updated_at": datetime.now(timezone.utc),
    }

    db.collection("daily_questions").document("08_correlation_10y").set(data)
    print("Écrit dans Firestore avec succès :")
    print(data)
