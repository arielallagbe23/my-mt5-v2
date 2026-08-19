#!/usr/bin/env python3
"""
alerte_pre_cloture.py — Alerte ~10 minutes avant la clôture des bougies H1
et H4 sur USDJPY, pour avoir le temps de regarder la situation et
éventuellement préparer une tâche avant que la bougie ne clôture réellement.

Calcule l'heure de clôture ATTENDUE de la bougie en cours (heure d'ouverture
+ durée du timeframe) plutôt que de deviner une heure fixe. IMPORTANT :
candle["time"] renvoyé par l'API MT5 est exprimé dans l'heure SERVEUR du
broker (ex: FTMO tourne en GMT+3 l'été, GMT+2 l'hiver), pas en UTC réel —
piège classique de l'API. On calcule le décalage en direct via un tick live
(_broker_offset_seconds) plutôt que de coder un décalage en dur, qui
casserait au changement d'heure (le nôtre ou celui du broker, pas forcément
synchronisés). Appelé à chaque tour de la boucle principale (mt5_status.py,
toutes les POLL_INTERVAL secondes) : la fenêtre d'alerte fait 10 minutes de
large, donc largement de quoi retomber dedans avant qu'elle ne se referme,
et le dédoublonnage Firestore (last_candle_open) garantit une seule notif
par bougie.

IMPORTANT (quota Firestore, optimisé) : settings/alerts (le toggle H1/H4 de
la page Profil) était relu à chaque tour (~10s) alors qu'il ne change que
si l'utilisateur y touche — remplacé par un ÉCOUTEUR TEMPS RÉEL
(on_snapshot) : Firestore nous POUSSE la nouvelle valeur uniquement quand
elle change vraiment, zéro lecture entre deux changements (potentiellement
des mois), au lieu d'interroger "est-ce que ça a changé ?" en boucle. Le
marqueur de dédoublonnage (alerts/pre_close_h1/h4) n'est lu qu'UNE FOIS au
démarrage (pour restaurer l'état si le process redémarre en pleine fenêtre
d'alerte) puis gardé en mémoire — rien d'autre que ce script n'écrit ces
documents, donc le cache local reste toujours juste après ce chargement.
"""

import threading
from datetime import datetime, timezone

from config import PRICE_SYMBOL
from mt5_client import ensure_mt5
from notify import notify

WARNING_MINUTES_BEFORE_CLOSE = 10

TIMEFRAMES = {
    "H1": 3600,
    "H4": 14400,
}

# Poussé par l'écouteur temps réel sur settings/alerts (voir
# _start_settings_listener) — jamais lu directement depuis Firestore dans
# le chemin chaud (check_pre_close_alerts). Si l'écouteur ne se connecte
# jamais (permission, réseau...), _enabled garde sa valeur par défaut
# (H1/H4 activés) indéfiniment SANS AUCUNE erreur — filet de sécurité :
# passé LISTENER_STARTUP_WARNING_SECONDS sans confirmation de connexion
# (_listener_ready), on log un avertissement explicite plutôt que de
# laisser une éventuelle panne totalement invisible.
_settings_lock = threading.Lock()
_enabled = {"H1": True, "H4": True}
_listener_started = False
_listener_ready = False
_listener_started_at = None

LISTENER_STARTUP_WARNING_SECONDS = 60
_startup_warning_shown = False

# Dernière bougie déjà alertée par timeframe (open_time_broker), chargée
# une seule fois depuis Firestore au démarrage puis gardée en mémoire.
_last_alerted_open = {}
_alert_state_loaded = False


def _on_settings_snapshot(doc_snapshot, changes, read_time):
    global _listener_ready
    for doc in doc_snapshot:
        data = doc.to_dict() or {}
        with _settings_lock:
            _enabled["H1"] = data.get("h1", True)
            _enabled["H4"] = data.get("h4", True)
            _listener_ready = True


def _start_settings_listener(db):
    """Démarre l'écouteur une seule fois (thread géré par le SDK Firestore) —
    idempotent, sans effet si déjà démarré."""
    global _listener_started, _listener_started_at
    if _listener_started:
        return
    db.collection("settings").document("alerts").on_snapshot(_on_settings_snapshot)
    _listener_started = True
    _listener_started_at = datetime.now(timezone.utc).timestamp()


def _check_listener_health():
    """Avertit une seule fois si l'écouteur n'a toujours pas confirmé sa
    connexion après un long moment — sinon on continuerait à utiliser
    silencieusement les valeurs par défaut sans jamais savoir pourquoi."""
    global _startup_warning_shown
    if _listener_ready or _startup_warning_shown or _listener_started_at is None:
        return
    elapsed = datetime.now(timezone.utc).timestamp() - _listener_started_at
    if elapsed > LISTENER_STARTUP_WARNING_SECONDS:
        print(
            f"[ALERT] ATTENTION : écouteur Firestore (settings/alerts) toujours pas connecté "
            f"après {elapsed:.0f}s — le réglage H1/H4 utilisé reste la valeur par défaut, "
            "vérifie la connexion réseau et les permissions Firestore"
        )
        _startup_warning_shown = True


def _load_alert_state(db):
    """Restaure le dédoublonnage depuis Firestore, une seule fois au
    démarrage — pour ne pas re-notifier si le process redémarre en pleine
    fenêtre d'alerte."""
    global _alert_state_loaded
    for label in TIMEFRAMES:
        doc = db.collection("alerts").document(f"pre_close_{label.lower()}").get()
        if doc.exists:
            _last_alerted_open[label] = doc.to_dict().get("last_candle_open")
    _alert_state_loaded = True


def _broker_offset_seconds(m, symbol):
    """Écart entre l'heure "UTC" mensongère de l'API MT5 (en réalité l'heure
    serveur du broker) et l'heure UTC réelle, mesuré en direct sur un tick
    live — pas de fuseau codé en dur, ça reste correct même après un
    changement d'heure d'été/hiver (le nôtre ou celui du broker)."""
    tick = m.symbol_info_tick(symbol)
    if tick is None:
        return 0
    return int(tick.time) - int(datetime.now(timezone.utc).timestamp())


def check_pre_close_alerts(db):
    """Point d'entrée appelé depuis la boucle de mt5_status.py — même pattern
    que check_due_tasks(db) dans tasks.py. Sans effet si MT5 est
    temporairement indisponible (retenté au tour de boucle suivant)."""
    m = ensure_mt5()
    if m is None:
        return

    _start_settings_listener(db)
    _check_listener_health()
    if not _alert_state_loaded:
        _load_alert_state(db)

    with _settings_lock:
        enabled = dict(_enabled)

    broker_offset = _broker_offset_seconds(m, PRICE_SYMBOL)
    for label, duration_seconds in TIMEFRAMES.items():
        if not enabled.get(label, True):
            continue
        check_timeframe(db, m, PRICE_SYMBOL, label, duration_seconds, broker_offset)


def check_timeframe(db, m, symbol, label, duration_seconds, broker_offset):
    m.symbol_select(symbol, True)
    rates = m.copy_rates_from_pos(symbol, getattr(m, f"TIMEFRAME_{label}"), 0, 1)
    if rates is None or len(rates) == 0:
        print(f"[{label}] Aucune bougie reçue, ignoré.")
        return

    candle = rates[0]
    open_time_broker = int(candle["time"])  # heure serveur broker, pas UTC
    close_time_utc = open_time_broker + duration_seconds - broker_offset
    now_utc = int(datetime.now(timezone.utc).timestamp())
    seconds_to_close = close_time_utc - now_utc

    in_window = 0 <= seconds_to_close <= WARNING_MINUTES_BEFORE_CLOSE * 60
    already_alerted = _last_alerted_open.get(label) == open_time_broker

    if in_window and not already_alerted:
        minutes_left = round(seconds_to_close / 60)
        notify(
            f"USDJPY — {label} clôture dans {minutes_left} min",
            "Vérifie la situation, prépare une tâche si besoin.",
        )
        db.collection("alerts").document(f"pre_close_{label.lower()}").set({
            "last_candle_open": open_time_broker,
            "updated_at": datetime.now(timezone.utc),
        })
        _last_alerted_open[label] = open_time_broker
        print(f"[OK][{label}] Alerte envoyée, clôture dans {minutes_left} min")
    elif in_window:
        # Silencieux en dehors de la fenêtre des 10 minutes — sinon ce log
        # s'affiche à chaque tour (~10s) pendant ~4h par bougie H4 pour rien,
        # juste bruit. Dans la fenêtre, ça confirme que le déjà_alerté joue
        # bien son rôle de dédoublonnage.
        print(f"[SKIP][{label}] fenêtre={in_window} déjà_alerté={already_alerted}")


if __name__ == "__main__":
    from google.cloud import firestore

    from config import SA_PATH

    _db = firestore.Client.from_service_account_json(SA_PATH)
    check_pre_close_alerts(_db)
