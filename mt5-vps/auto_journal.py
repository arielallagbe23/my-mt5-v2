"""
auto_journal.py — Crée automatiquement une entrée dans le journal "Erreurs
et succès" (collection Firestore mistakes, voir src/pages/MistakesPage.jsx)
à chaque position fermée sur le COMPTE PRINCIPAL — appelé depuis
trades.py::check_closed_positions uniquement (jamais pour l'import en masse
de l'historique, ni pour les comptes suppléants, qui ne tradent jamais de
façon indépendante hors "Ordre par compte").

Pré-remplit la durée du trade, le gain/perte réalisé et la raison de sortie
(SL/TP/autre) ; les autres champs (plan respecté, émotion, stratégie,
leçon) restent vides, à compléter à la main dans l'app ensuite.

Tente aussi d'attacher un graphique du trade (bougies + zones TP/SL, voir
trade_chart.py) — dans son propre try/except, pour qu'un échec (MT5,
réseau, Blob...) ne fasse jamais échouer la création de l'entrée elle-même.
"""

import time

import trade_chart

# "SL"/"TP" (voir trades._reason_name) -> valeur attendue par exitReason
# côté app (server/src/routes/mistakes.js, EXIT_VALUES) ; tout le reste
# (CLIENT/MOBILE/WEB/EXPERT/STOP_OUT — fermeture manuelle ou stop-out) ->
# "other", impossible à deviner plus précisément depuis le VPS seul.
EXIT_REASON_MAP = {"SL": "sl", "TP": "tp"}

# userId du seul utilisateur de cette app — il n'y a pas de notion d'auth
# côté VPS (contrairement à l'app, qui lit un cookie JWT — voir
# server/src/middleware/auth.js), donc on résout le premier (et seul) doc
# de la collection users une fois, puis on garde le résultat en cache.
_owner_user_id = None


def _resolve_owner_user_id(db):
    global _owner_user_id
    if _owner_user_id is not None:
        return _owner_user_id
    docs = list(db.collection("users").limit(1).stream())
    if not docs:
        return None
    _owner_user_id = docs[0].id
    return _owner_user_id


def _format_duration(seconds):
    seconds = max(0, int(seconds))
    hours, remainder = divmod(seconds, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours:
        return f"{hours}h{minutes:02d}"
    if minutes:
        return f"{minutes}min"
    return f"{secs}s"


def create_entry_from_trade(db, m, trade):
    """trade = le dict retourné par trades._deals_to_trade. Ne fait rien
    (juste un log) si aucun utilisateur n'est trouvé — ne doit jamais
    empêcher check_closed_positions d'avoir déjà écrit le trade lui-même."""
    user_id = _resolve_owner_user_id(db)
    if user_id is None:
        print("[AUTO_JOURNAL] aucun utilisateur trouvé, entrée non créée")
        return

    duration = _format_duration(trade["closeTime"] - trade["openTime"])
    sign = "+" if trade["net"] >= 0 else ""
    description = (
        f"{trade['symbol']} {trade['type']} {trade['volume']} lot — "
        f"{trade['priceOpen']} → {trade['priceClose']} — durée {duration} — "
        f"{sign}{trade['net']:.2f}$ (clôturé automatiquement)"
    )
    exit_reason = EXIT_REASON_MAP.get(trade["reason"], "other")

    # tradeId : référence au ticket MT5 d'origine, pour pouvoir relier cette
    # entrée à son trade plus tard (ex: backfill_trade_charts.py) — absent
    # des entrées créées avant ce champ.
    doc_ref = db.collection("mistakes").add({
        "userId": user_id,
        "tradeId": trade["positionId"],
        "description": description,
        "planRespected": None,
        "exitReason": exit_reason,
        "emotion": None,
        "strategy": None,
        "lesson": "",
        "createdAt": int(time.time() * 1000),
        "images": [],
    })[1]
    print(
        f"[AUTO_JOURNAL] entrée créée pour la position {trade['positionId']} "
        f"({exit_reason}, {sign}{trade['net']:.2f}$)"
    )

    try:
        trade_chart.generate_and_attach(db, m, trade, doc_ref.id)
    except Exception:
        import traceback

        print(f"[CHART] échec génération graphique pour la position {trade['positionId']} :")
        traceback.print_exc()
