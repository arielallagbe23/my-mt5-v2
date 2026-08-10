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
    """N'échoue jamais bruyamment (une notif ratée ne doit pas interrompre
    l'appelant) mais retourne True/False pour que les appelants qui veulent
    vérifier le résultat (ex: test_notify.py) puissent le faire."""
    if not CRON_SECRET:
        print("[NOTIFY] échec : CRON_SECRET absent (mt5-vps/cron_secret.txt manquant ou vide)")
        return False
    req = urllib.request.Request(
        f"{BACKEND_URL}/api/notify",
        data=json.dumps({"title": title, "body": body}).encode("utf-8"),
        headers={"Authorization": f"Bearer {CRON_SECRET}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=10)
        return True
    except Exception as e:
        print(f"[NOTIFY] échec : {e}")
        return False
