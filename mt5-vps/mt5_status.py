"""
mt5_status.py — Point d'entrée du VPS. Toutes les POLL_INTERVAL secondes :
  - répond aux demandes ponctuelles de l'app (on_demand.py) — aucune écriture
    en continu ;
  - scanne les tâches de trading dues et les exécute (tasks.py) ;
  - surveille les ordres différés et positions ouvertes : notifie un
    déclenchement d'ordre, et la progression d'une position vers son TP
    (positions.py).

Tout tourne côté VPS, en connexions sortantes uniquement (Firestore + appels
à l'API Vercel pour les notifications) — aucun port n'est jamais ouvert ici,
le frontend ne se connecte jamais directement au VPS.

Découpage du code (tout dans ce même dossier mt5-vps/) :
  config.py      — constantes et paramètres (fichiers locaux / variables d'env)
  mt5_client.py  — connexion MT5 avec reconnexion automatique
  notify.py      — envoi de notifications push via l'API Vercel
  on_demand.py   — réponses aux demandes ponctuelles (équité, prix, bougie, positions)
  scenarios.py   — logique de trading pure (taille de position, conditions d'entrée)
  tasks.py       — scan + exécution des tâches dues (utilise mt5_client + scenarios)
  positions.py   — surveillance des déclenchements d'ordres et progression vers le TP

Pré-requis (sur le VPS) :
  pip install -r requirements.txt
  service-account.json — clé Firebase Admin (même projet que l'app React)
  vps_id.txt            — optionnel, identifiant de ce VPS (défaut "main")
  cron_secret.txt        — même valeur que CRON_SECRET côté Vercel (notifications)
  dry_run.txt             — "true" (défaut) ou "false" — passer à "false" une
                            fois le comportement vérifié pour exécuter en réel
"""

import os
import time

from config import POLL_INTERVAL, SA_PATH, VPS_ID
from on_demand import check_candle_request, check_positions_request, check_price_request, check_status_request
from positions import check_order_fills, check_tp_progress
from tasks import check_due_tasks


def run():
    from google.cloud import firestore

    if not os.path.exists(SA_PATH):
        raise SystemExit(f"[ERREUR] {SA_PATH} introuvable.")

    db = firestore.Client.from_service_account_json(SA_PATH)
    print(f"[BOOT] VPS_ID={VPS_ID} | poll={POLL_INTERVAL}s")

    while True:
        try:
            check_status_request(db)
            check_price_request(db)
            check_candle_request(db)
            check_positions_request(db)
            check_due_tasks(db)
            check_order_fills(db)
            check_tp_progress(db)
        except Exception as e:
            print(f"[LOOP] erreur : {e}")
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    run()
