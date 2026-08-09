#!/usr/bin/env python3
"""
Question 3 — Où en est le risque d'intervention BoJ/MoF ?

Combine 3 signaux bruts (prix USDJPY vs seuil de vigilance, vitesse du
mouvement sur 5 jours de bourse, déclarations récentes évoquant une
intervention) en un niveau de risque simple, par règle — pas de jugement
LLM. Réutilise les clés déjà en place (FRED_API_KEY, SERPAPI_KEY) et le prix
live déjà alimenté par mt5_status.py, aucune nouvelle clé nécessaire.
"""

import requests
from datetime import datetime, timezone
from google.cloud import firestore

from config import FRED_API_KEY, SERPAPI_KEY, SA_PATH

db = firestore.Client.from_service_account_json(SA_PATH)

# Zone de vigilance et seuil de "mouvement rapide" — à remettre à jour toi-même
# selon le contexte de marché (dernière intervention connue : ~160-163, courant
# 2026). Ce ne sont pas des vérités figées, juste des repères à ajuster.
INTERVENTION_WATCH_LEVEL = 155.0
RAPID_MOVE_THRESHOLD_PCT = 3.0


def get_usdjpy_history(limit=8):
    r = requests.get("https://api.stlouisfed.org/fred/series/observations", params={
        "series_id": "DEXJPUS", "api_key": FRED_API_KEY,
        "file_type": "json", "sort_order": "desc", "limit": limit,
    })
    r.raise_for_status()
    obs = r.json()["observations"]
    # FRED renvoie "." les jours sans donnée (marché fermé) — on les ignore.
    return [float(o["value"]) for o in obs if o["value"] != "."]


def get_live_usdjpy():
    doc = db.collection("prices").document("USDJPY").get()
    if not doc.exists:
        return None
    data = doc.to_dict()
    bid, ask = data.get("bid"), data.get("ask")
    if bid is None or ask is None:
        return None
    return (bid + ask) / 2


def _search_news(query, hl=None, gl=None):
    params = {"q": query, "tbm": "nws", "tbs": "qdr:d2", "api_key": SERPAPI_KEY}
    if hl:
        params["hl"] = hl
    if gl:
        params["gl"] = gl
    r = requests.get("https://serpapi.com/search.json", params=params)
    r.raise_for_status()
    return r.json().get("news_results", [])[:5]


def get_intervention_headlines():
    # Même logique que 01_taux_fed_boj.py : sources francophones d'abord,
    # repli sur l'anglais si rien trouvé.
    news = _search_news("BoJ MOF yen intervention avertissement", hl="fr", gl="fr")
    if not news:
        news = _search_news("BoJ MOF yen intervention warning")
    return [n["title"] for n in news]


if __name__ == "__main__":
    fred_prices = get_usdjpy_history()
    reference_price = fred_prices[5] if len(fred_prices) > 5 else fred_prices[-1]
    current_price = get_live_usdjpy() or fred_prices[0]

    pct_change_5j = round((current_price - reference_price) / reference_price * 100, 2)
    prix_proche_seuil = current_price >= INTERVENTION_WATCH_LEVEL
    mouvement_rapide = abs(pct_change_5j) >= RAPID_MOVE_THRESHOLD_PCT
    declarations_recentes = get_intervention_headlines()

    signaux_actifs = sum([prix_proche_seuil, mouvement_rapide, bool(declarations_recentes)])
    niveau_risque = "élevé" if signaux_actifs >= 2 else ("modéré" if signaux_actifs == 1 else "faible")

    data = {
        "prix_actuel": current_price,
        "variation_5j_pct": pct_change_5j,
        "seuil_vigilance": INTERVENTION_WATCH_LEVEL,
        "prix_proche_seuil": prix_proche_seuil,
        "mouvement_rapide": mouvement_rapide,
        "declarations_recentes": declarations_recentes,
        "niveau_risque": niveau_risque,
        "updated_at": datetime.now(timezone.utc),
    }

    db.collection("daily_questions").document("03_risque_intervention").set(data)
    print("Écrit dans Firestore avec succès :")
    print(data)
