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

# Chemin vers le terminal64.exe du compte PRINCIPAL — obligatoire dès que
# plusieurs terminaux MT5 tournent sur la même machine (voir mt5_client.py :
# initialize() sans chemin explicite peut se connecter au mauvais terminal).
# Optionnel tant qu'un seul terminal MT5 tourne sur la VPS.
MASTER_TERMINAL_PATH = _read("master_terminal_path.txt") or os.environ.get("MASTER_TERMINAL_PATH")
POLL_INTERVAL = float(os.environ.get("POLL_INTERVAL", "10"))
PRICE_SYMBOL = "USDJPY"
MAGIC = int(os.environ.get("MT5_MAGIC", "234000"))

# Notifications push envoyées via l'API Vercel (clé VAPID côté serveur uniquement).
BACKEND_URL = os.environ.get("BACKEND_URL", "https://mymt5-v2.vercel.app")
CRON_SECRET = _read("cron_secret.txt") or os.environ.get("CRON_SECRET")

# Clés API pour 01_taux_fed_boj.py — jamais commitées, même régime que cron_secret.txt.
FRED_API_KEY = _read("fred_api_key.txt") or os.environ.get("FRED_API_KEY")
SERPAPI_KEY = _read("serpapi_key.txt") or os.environ.get("SERPAPI_KEY")

# Clé API Anthropic pour 09_bilan_quotidien.py — jamais commitée, même régime.
ANTHROPIC_API_KEY = _read("anthropic_key.txt") or os.environ.get("ANTHROPIC_API_KEY")

# Tant que dry_run.txt contient "true" (ou n'existe pas), les tâches sont évaluées
# et notifiées normalement mais AUCUN ordre réel n'est envoyé à MT5. Repasser à
# "false" dans ce fichier une fois le comportement vérifié plusieurs fois.
DRY_RUN = (_read("dry_run.txt") or os.environ.get("DRY_RUN", "true")).strip().lower() != "false"

CONTRACT_SIZE = 100000  # 1 lot standard = 100 000 unités de la devise de base (ex: USD pour USDJPY)
FEE_BUFFER = 0.05  # on réduit le lot de 5% pour laisser de la marge aux commissions/spread
MAX_RISK_PERCENT = 2  # garde-fou : jamais plus de 2% du capital risqué, même si l'API a été contournée
