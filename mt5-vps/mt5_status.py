"""
mt5_status.py — Point d'entrée du VPS. Toutes les POLL_INTERVAL secondes :
  - répond aux demandes ponctuelles de l'app en UNE requête Firestore groupée
    (on_demand.py) — pas de lecture fixe par type de commande ;
  - scanne les tâches de trading dues et les exécute (tasks.py) ;
  - scanne les ordres manuels programmés à heure fixe et les exécute, avec
    réessai automatique en cas d'échec temporaire (scheduled_orders.py) ;
  - alerte ~10 min avant chaque clôture de bougie H1/H4 sur USDJPY
    (alerte_pre_cloture.py) ;
  - alerte 5 min avant l'ouverture de chaque session (Tokyo, Londres, New
    York), les jours ouvrés uniquement, jamais plus d'une fois par session
    et par jour (session_alerts.py) ;
  - surveille les ordres différés et positions ouvertes : notifie un
    déclenchement d'ordre, la progression vers le TP, notifie où en est
    chaque position suivie (TP/SL) à chaque clôture H1/H4 et déplace le SL
    par paliers (BE, 25%, 50%) — respecte DRY_RUN comme le reste
    (order_fills.py, untracked_positions.py, tp_progress.py, trailing_stop.py) ;
  - notifie la clôture d'une position suivie ou non, avec son résultat net
    (alerte_me_by_level.py) ;
  - alimente l'historique des trades fermés (trades.py) ;
  - publie l'état des positions ouvertes et des ordres différés pour le
    compte suppléant (mirror_publish.py — voir mirror_follower.py, process séparé).

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
  scheduled_orders.py       — scan + exécution des ordres manuels programmés (même pattern que tasks.py, sans scénario)
  alerte_pre_cloture.py     — alerte ~10 min avant clôture H1/H4 sur USDJPY
  session_alerts.py         — alerte 5 min avant l'ouverture de Tokyo/Londres/New York
  position_shared.py        — primitives partagées par les modules ci-dessous (timeframe, bougies, progression)
  order_fills.py            — détecte un ordre différé qui se transforme en position
  untracked_positions.py    — détecte une position ouverte hors mymt5
  tp_progress.py            — notifie la progression vers le TP (seuils 50/75/95/100%, basé sur le pic)
  trailing_stop.py          — rapport de situation (PE/TP/SL) + déplacement du SL par paliers, à chaque clôture H1/H4
  alerte_me_by_level.py     — notif de clôture de position (résultat net), à chaque tour de boucle
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

from alerte_me_by_level import check_closed_positions_notify
from alerte_pre_cloture import check_pre_close_alerts
from config import MASTER_TERMINAL_PATH, POLL_INTERVAL, SA_PATH, VPS_ID
from mirror_publish import publish_master_orders, publish_master_positions
from mt5_client import set_default_path
from on_demand import check_all_requests
from order_fills import check_order_fills
from scheduled_orders import check_due_scheduled_orders
from session_alerts import check_session_alerts
from tasks import check_due_tasks
from tp_progress import check_tp_progress
from trades import check_closed_positions
from trailing_stop import check_trailing_stop
from untracked_positions import check_untracked_positions


def _run_safely(name, func, db):
    """Exécute UN check isolément : une exception ici ne doit jamais empêcher
    les checks suivants de tourner sur ce même tour de boucle. Avant ce
    correctif, tous les checks partageaient un seul try/except autour de la
    boucle entière — une exception dans l'un d'eux (ex: une donnée MT5
    transitoirement absente) sautait silencieusement TOUS les checks
    suivants pour tout le tour (potentiellement ceux qui notifient une
    clôture de position ou une progression de TP), avec pour seule trace un
    traceback perdu dans une console non surveillée. Symptôme observé :
    notifications manquantes sans aucune erreur visible côté notify()."""
    try:
        func(db)
    except Exception:
        print(f"[LOOP] erreur dans {name} :")
        traceback.print_exc()


def run():
    from google.cloud import firestore

    if not os.path.exists(SA_PATH):
        raise SystemExit(f"[ERREUR] {SA_PATH} introuvable.")

    # Indispensable dès qu'un deuxième terminal MT5 tourne sur la machine
    # (compte suppléant) — sans ça, la connexion peut se faire au hasard sur
    # le mauvais terminal (voir mt5_client.py).
    set_default_path(MASTER_TERMINAL_PATH)

    db = firestore.Client.from_service_account_json(SA_PATH)
    print(f"[BOOT] VPS_ID={VPS_ID} | poll={POLL_INTERVAL}s | terminal={MASTER_TERMINAL_PATH or '(défaut)'}")

    checks = [
        ("check_all_requests", check_all_requests),
        ("check_due_tasks", check_due_tasks),
        ("check_due_scheduled_orders", check_due_scheduled_orders),
        ("check_pre_close_alerts", check_pre_close_alerts),
        ("check_session_alerts", check_session_alerts),
        ("check_order_fills", check_order_fills),
        ("check_untracked_positions", check_untracked_positions),
        ("check_tp_progress", check_tp_progress),
        ("check_trailing_stop", check_trailing_stop),
        ("check_closed_positions_notify", check_closed_positions_notify),
        ("check_closed_positions", check_closed_positions),
        ("publish_master_positions", publish_master_positions),
        ("publish_master_orders", publish_master_orders),
    ]

    while True:
        for name, func in checks:
            _run_safely(name, func, db)
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    run()
