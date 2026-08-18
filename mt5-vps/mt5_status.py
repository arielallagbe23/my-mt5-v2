"""
mt5_status.py — Point d'entrée du VPS. Toutes les POLL_INTERVAL secondes :
  - répond aux demandes ponctuelles de l'app en UNE requête Firestore groupée
    (on_demand.py) — pas de lecture fixe par type de commande ;
  - scanne les tâches de trading dues et les exécute (tasks.py) ;
  - alerte ~10 min avant chaque clôture de bougie H1/H4 sur USDJPY
    (alerte_pre_cloture.py) ;
  - surveille les ordres différés et positions ouvertes : notifie un
    déclenchement d'ordre, la progression vers le TP, et déplace le SL par
    paliers (BE, 25%, 50%) — respecte DRY_RUN comme le reste (order_fills.py,
    untracked_positions.py, tp_progress.py, trailing_stop.py) ;
  - alimente l'historique des trades fermés (trades.py) ;
  - publie l'état des positions ouvertes pour le compte suppléant
    (mirror_publish.py — voir mirror_follower.py, process séparé).

Tout tourne côté VPS, en connexions sortantes uniquement (Firestore + appels
à l'API Vercel pour les notifications) — aucun port n'est jamais ouvert ici,
le frontend ne se connecte jamais directement au VPS.

Découpage du code (tout dans ce même dossier mt5-vps/), une responsabilité
par fichier :
  config.py                — constantes et paramètres (fichiers locaux / variables d'env)
  mt5_client.py             — connexion MT5 avec reconnexion automatique
  notify.py                 — envoi de notifications push via l'API Vercel
  on_demand.py              — réponses aux demandes ponctuelles (équité, prix, bougie, positions)
  scenarios.py              — logique de trading pure (taille de position, conditions d'entrée)
  tasks.py                  — scan + exécution des tâches dues (utilise mt5_client + scenarios)
  alerte_pre_cloture.py     — alerte ~10 min avant clôture H1/H4 sur USDJPY
  position_shared.py        — primitives partagées par les 4 modules ci-dessous (timeframe, bougies, progression)
  order_fills.py            — détecte un ordre différé qui se transforme en position
  untracked_positions.py    — détecte une position ouverte hors mymt5
  tp_progress.py            — notifie la progression vers le TP (seuils 50/75/95/100%, basé sur le pic)
  trailing_stop.py          — déplace le SL par paliers (basé sur la clôture, pas le pic)
  trades.py                 — historique des trades fermés (import + alimentation automatique)
  mirror_publish.py         — publie les positions pour le compte suppléant (voir mirror_follower.py)

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
import traceback

from alerte_pre_cloture import check_pre_close_alerts
from config import POLL_INTERVAL, SA_PATH, VPS_ID
from mirror_publish import publish_master_positions
from on_demand import check_all_requests
from order_fills import check_order_fills
from tasks import check_due_tasks
from tp_progress import check_tp_progress
from trades import check_closed_positions
from trailing_stop import check_trailing_stop
from untracked_positions import check_untracked_positions


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
            check_closed_positions(db)
            publish_master_positions(db)
        except Exception:
            print("[LOOP] erreur :")
            traceback.print_exc()
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    run()
