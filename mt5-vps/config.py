"""
config.py — Constantes et paramètres du VPS, lus depuis des fichiers locaux ou
des variables d'environnement (fichier prioritaire s'il existe).
"""

import os

_DIR = os.path.dirname(os.path.abspath(__file__))


def _read(name, default=None):
    path = os.path.join(_DIR, name)
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8-sig") as f:
        return f.read().strip()


VPS_ID = _read("vps_id.txt") or os.environ.get("VPS_ID", "main")
SA_PATH = os.path.join(_DIR, "service-account.json")
POLL_INTERVAL = float(os.environ.get("POLL_INTERVAL", "10"))
PRICE_SYMBOL = "USDJPY"
MAGIC = int(os.environ.get("MT5_MAGIC", "234000"))

# Notifications push envoyées via l'API Vercel (clé VAPID côté serveur uniquement).
BACKEND_URL = os.environ.get("BACKEND_URL", "https://mymt5-v2.vercel.app")
CRON_SECRET = _read("cron_secret.txt") or os.environ.get("CRON_SECRET")

# Tant que dry_run.txt contient "true" (ou n'existe pas), les tâches sont évaluées
# et notifiées normalement mais AUCUN ordre réel n'est envoyé à MT5. Repasser à
# "false" dans ce fichier une fois le comportement vérifié plusieurs fois.
DRY_RUN = (_read("dry_run.txt") or os.environ.get("DRY_RUN", "true")).strip().lower() != "false"

CONTRACT_SIZE = 100000  # 1 lot standard = 100 000 unités de la devise de base (ex: USD pour USDJPY)
FEE_BUFFER = 0.05  # on réduit le lot de 5% pour laisser de la marge aux commissions/spread
MAX_RISK_PERCENT = 2  # garde-fou : jamais plus de 2% du capital risqué, même si l'API a été contournée
