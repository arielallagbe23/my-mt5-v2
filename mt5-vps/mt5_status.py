"""
mt5_status.py — Point d'entrée du VPS. Toutes les POLL_INTERVAL secondes :
  - répond aux demandes ponctuelles de l'app en UNE requête Firestore groupée
    (on_demand.py) — pas de lecture fixe par type de commande ;
  - scanne les tâches de trading dues et les exécute (tasks.py) ;
  - alerte ~10 min avant chaque clôture de bougie H1/H4 sur USDJPY
    (alerte_pre_cloture.py) ;
  - surveille les ordres différés et positions ouvertes : notifie un
    déclenchement d'ordre, la progression vers le TP, déplace le SL par
    paliers (BE, 25%, 50%) — respecte DRY_RUN comme le reste — et envoie un
    point horaire du niveau atteint par chaque position suivie (positions.py) ;
  - alimente l'historique des trades fermés (trades.py).

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
  alerte_pre_cloture.py — alerte ~10 min avant clôture H1/H4 sur USDJPY
  positions.py   — surveillance des déclenchements d'ordres et progression vers le TP
  trades.py      — historique des trades fermés (import + alimentation automatique)

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

from alerte_pre_cloture import check_pre_close_alerts
from config import POLL_INTERVAL, SA_PATH, VPS_ID
from on_demand import check_all_requests
from positions import (
    check_hourly_update,
    check_order_fills,
    check_tp_progress,
    check_trailing_stop,
    check_untracked_positions,
)
from tasks import check_due_tasks
from trades import check_closed_positions


def run():
    from google.cloud import firestore

    if not os.path.exists(SA_PATH):
        raise SystemExit(f"[ERREUR] {SA_PATH} introuvable.")

    db = firestore.Client.from_service_account_json(SA_PATH)
    print(f"[BOOT] VPS_ID={VPS_ID} | poll={POLL_INTERVAL}s")

    while True:
        try:
            check_all_requests(db)
            check_due_tasks(db)
            check_pre_close_alerts(db)
            check_order_fills(db)
            check_untracked_positions(db)
            check_tp_progress(db)
            check_trailing_stop(db)
            check_hourly_update(db)
            check_closed_positions(db)
        except Exception as e:
            print(f"[LOOP] erreur : {e}")
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    run()
