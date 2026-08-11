#!/usr/bin/env python3
"""
Question 1 — Où en est le différentiel de taux Fed/BoJ ?

Collecte 3 données brutes (rendement 10 ans US, taux Fed, actu Fed/BoJ)
et les écrit dans Firestore. Pas d'analyse ici — juste la donnée.

Pré-requis : fred_api_key.txt et serpapi_key.txt dans ce dossier VPS (jamais
commités, même régime que cron_secret.txt) — voir config.py.
"""

import time

import requests
from datetime import datetime, timezone
from google.cloud import firestore

from config import FRED_API_KEY, SERPAPI_KEY, SA_PATH
from notify import notify

db = firestore.Client.from_service_account_json(SA_PATH)

RETRIES = 3
BACKOFF_SECONDS = 5


def _get_with_retry(url, params):
    """Un blip réseau ou un timeout ponctuel d'une seconde ne doit pas faire
    planter tout le script (et donc laisser la donnée du jour manquante) —
    on retente quelques fois avant d'abandonner pour de vrai."""
    last_error = None
    for attempt in range(1, RETRIES + 1):
        try:
            r = requests.get(url, params=params, timeout=10)
            r.raise_for_status()
            return r
        except requests.exceptions.RequestException as e:
            last_error = e
            if attempt < RETRIES:
                time.sleep(BACKOFF_SECONDS * attempt)
    raise last_error


def get_us_10y_yield():
    r = _get_with_retry("https://api.stlouisfed.org/fred/series/observations", {
        "series_id": "DGS10", "api_key": FRED_API_KEY,
        "file_type": "json", "sort_order": "desc", "limit": 1,
    })
    obs = r.json()["observations"][0]
    return {"valeur": float(obs["value"]), "date": obs["date"]}


def get_fed_funds_rate():
    r = _get_with_retry("https://api.stlouisfed.org/fred/series/observations", {
        "series_id": "DFF", "api_key": FRED_API_KEY,
        "file_type": "json", "sort_order": "desc", "limit": 1,
    })
    obs = r.json()["observations"][0]
    return {"valeur": float(obs["value"]), "date": obs["date"]}


def _search_news(query, hl=None, gl=None):
    params = {"q": query, "tbm": "nws", "tbs": "qdr:d2", "api_key": SERPAPI_KEY}
    if hl:
        params["hl"] = hl
    if gl:
        params["gl"] = gl
    r = _get_with_retry("https://serpapi.com/search.json", params)
    return r.json().get("news_results", [])[:5]


def get_recent_fed_boj_headlines():
    # hl/gl biaisent la recherche vers des sources francophones (pas de vraie
    # traduction). La couverture Fed/BoJ y est plus rare qu'en anglais et peut
    # ne rien renvoyer certains jours — on retombe alors sur la recherche
    # anglaise plutôt que de laisser la liste vide.
    news = _search_news("Fed BoJ taux directeur déclaration politique monétaire", hl="fr", gl="fr")
    if not news:
        news = _search_news("Fed BoJ interest rate statement policy")
    return [n["title"] for n in news]


if __name__ == "__main__":
    try:
        data = {
            "us_10y_yield": get_us_10y_yield(),
            "fed_funds_rate": get_fed_funds_rate(),
            "recent_headlines": get_recent_fed_boj_headlines(),
            "updated_at": datetime.now(timezone.utc),
        }
        db.collection("daily_questions").document("01_taux_fed_boj").set(data)
        print("Écrit dans Firestore avec succès :")
        print(data)
    except Exception as e:
        notify(
            "mymt5 — échec 01_taux_fed_boj",
            f"Différentiel de taux Fed/BoJ non mis à jour : {e}",
        )
        raise