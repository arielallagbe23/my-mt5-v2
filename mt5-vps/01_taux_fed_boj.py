#!/usr/bin/env python3
"""
Question 1 — Où en est le différentiel de taux Fed/BoJ ?

Collecte 3 données brutes (rendement 10 ans US, taux Fed, actu Fed/BoJ)
et les écrit dans Firestore. Pas d'analyse ici — juste la donnée.

Pré-requis : fred_api_key.txt et serpapi_key.txt dans ce dossier VPS (jamais
commités, même régime que cron_secret.txt) — voir config.py.
"""

import requests
from datetime import datetime, timezone
from google.cloud import firestore

from config import FRED_API_KEY, SERPAPI_KEY, SA_PATH

db = firestore.Client.from_service_account_json(SA_PATH)


def get_us_10y_yield():
    r = requests.get("https://api.stlouisfed.org/fred/series/observations", params={
        "series_id": "DGS10", "api_key": FRED_API_KEY,
        "file_type": "json", "sort_order": "desc", "limit": 1,
    })
    r.raise_for_status()
    obs = r.json()["observations"][0]
    return {"valeur": float(obs["value"]), "date": obs["date"]}


def get_fed_funds_rate():
    r = requests.get("https://api.stlouisfed.org/fred/series/observations", params={
        "series_id": "DFF", "api_key": FRED_API_KEY,
        "file_type": "json", "sort_order": "desc", "limit": 1,
    })
    r.raise_for_status()
    obs = r.json()["observations"][0]
    return {"valeur": float(obs["value"]), "date": obs["date"]}


def get_recent_fed_boj_headlines():
    r = requests.get("https://serpapi.com/search.json", params={
        "q": "Fed BoJ interest rate statement policy",
        "tbm": "nws", "tbs": "qdr:d2", "api_key": SERPAPI_KEY,
    })
    r.raise_for_status()
    news = r.json().get("news_results", [])[:5]
    return [n["title"] for n in news]


if __name__ == "__main__":
    data = {
        "us_10y_yield": get_us_10y_yield(),
        "fed_funds_rate": get_fed_funds_rate(),
        "recent_headlines": get_recent_fed_boj_headlines(),
        "updated_at": datetime.now(timezone.utc),
    }

    db.collection("daily_questions").document("01_taux_fed_boj").set(data)
    print("Écrit dans Firestore avec succès :")
    print(data)