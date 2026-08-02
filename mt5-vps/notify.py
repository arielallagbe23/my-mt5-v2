"""
notify.py — Envoie une notification push via l'API Vercel (POST /api/notify).
C'est la seule façon d'en envoyer : la clé VAPID privée n'existe que côté
serveur. Partagé par tous les modules qui ont besoin de notifier (tasks.py,
positions.py).
"""

import json
import urllib.request

from config import BACKEND_URL, CRON_SECRET


def notify(title, body):
    """Ne fait rien si CRON_SECRET est absent ; n'échoue jamais bruyamment
    (une notif ratée ne doit pas interrompre l'appelant)."""
    if not CRON_SECRET:
        return
    req = urllib.request.Request(
        f"{BACKEND_URL}/api/notify",
        data=json.dumps({"title": title, "body": body}).encode("utf-8"),
        headers={"Authorization": f"Bearer {CRON_SECRET}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=10)
    except Exception as e:
        print(f"[NOTIFY] échec : {e}")
