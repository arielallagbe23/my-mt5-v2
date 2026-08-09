#!/usr/bin/env python3
"""
Question 2 — Quel est le calendrier éco du jour et de la semaine ?

Collecte les événements macro à impact élevé/moyen pour USD et JPY depuis le
flux JSON public de Forex Factory (pas de clé API nécessaire) et les écrit
dans Firestore. Pas d'analyse ici — juste la donnée, filtrée et triée.
"""

import requests
from datetime import datetime, timezone
from dateutil import parser as date_parser
from google.cloud import firestore

from config import SA_PATH

db = firestore.Client.from_service_account_json(SA_PATH)

CALENDAR_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
CURRENCIES = {"USD", "JPY"}
IMPACTS = {"High", "Medium"}


def get_weekly_calendar():
    r = requests.get(CALENDAR_URL, timeout=10)
    r.raise_for_status()
    return r.json()


def filter_relevant_events(raw_events):
    relevant = []
    for evt in raw_events:
        if evt.get("country") not in CURRENCIES:
            continue
        if evt.get("impact") not in IMPACTS:
            continue
        relevant.append({
            "date": evt.get("date"),
            "devise": evt.get("country"),
            "impact": evt.get("impact"),
            "evenement": evt.get("title"),
            "prevision": evt.get("forecast"),
            "precedent": evt.get("previous"),
        })
    return relevant


def split_today_vs_week(events):
    today = datetime.now(timezone.utc).date()
    today_events, week_events = [], []
    for evt in events:
        try:
            evt_date = date_parser.parse(evt["date"]).date()
        except (ValueError, TypeError):
            continue
        if evt_date == today:
            today_events.append(evt)
        week_events.append(evt)
    return today_events, week_events


if __name__ == "__main__":
    raw = get_weekly_calendar()
    relevant = filter_relevant_events(raw)
    today_events, week_events = split_today_vs_week(relevant)

    data = {
        "evenements_du_jour": today_events,
        "evenements_de_la_semaine": week_events,
        "has_high_impact_today": any(e["impact"] == "High" for e in today_events),
        "updated_at": datetime.now(timezone.utc),
    }

    db.collection("daily_questions").document("02_calendrier_eco").set(data)
    print("Écrit dans Firestore avec succès :")
    print(data)
