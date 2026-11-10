"""
backfill_trade_charts.py — Script à lancer UNE FOIS À LA MAIN sur le VPS
(jamais depuis run_all.py) pour générer rétroactivement le graphique des
positions déjà clôturées et déjà présentes dans le journal (mistakes), mais
créées avant la mise en place de trade_chart.py — donc sans graphique.

Les entrées auto-créées avant ce script n'enregistraient pas encore de
référence au ticket MT5 d'origine (tradeId). On retrouve donc la
correspondance trade <-> entrée de journal en reconstruisant la
description EXACTE que auto_journal.py aurait générée pour chaque trade
(mêmes fonctions, même format) et en la comparant à la description
stockée — fiable tant que la description n'a pas été modifiée à la main
depuis. Les entrées sans correspondance unique sont listées sans être
traitées, pour vérification manuelle.

Usage : python backfill_trade_charts.py
"""

import time

from auto_journal import _format_duration, _resolve_owner_user_id
from config import MASTER_TERMINAL_PATH, SA_PATH
from mt5_client import ensure_mt5, set_default_path
from trade_chart import generate_and_attach


def _expected_description(trade):
    duration = _format_duration(trade["closeTime"] - trade["openTime"])
    sign = "+" if trade["net"] >= 0 else ""
    return (
        f"{trade['symbol']} {trade['type']} {trade['volume']} lot — "
        f"{trade['priceOpen']} → {trade['priceClose']} — durée {duration} — "
        f"{sign}{trade['net']:.2f}$ (clôturé automatiquement)"
    )


def run():
    from google.cloud import firestore

    db = firestore.Client.from_service_account_json(SA_PATH)

    # Indispensable dès qu'un deuxième terminal MT5 tourne sur la machine
    # (compte(s) suppléant(s)) — sans ça, ensure_mt5() peut se connecter au
    # hasard à un terminal non autorisé (voir mt5_client.py).
    set_default_path(MASTER_TERMINAL_PATH)
    m = ensure_mt5()
    if m is None:
        raise SystemExit("[BACKFILL] connexion MT5 impossible")

    user_id = _resolve_owner_user_id(db)
    if user_id is None:
        raise SystemExit("[BACKFILL] aucun utilisateur trouvé")

    by_description = {}
    for doc in db.collection("trades").stream():
        trade = doc.to_dict()
        by_description.setdefault(_expected_description(trade), []).append(trade)

    mistakes = list(db.collection("mistakes").where("userId", "==", user_id).stream())

    done = skipped = ambiguous = 0
    for doc in mistakes:
        data = doc.to_dict()
        if data.get("images"):
            continue  # déjà un graphique (ou une image manuelle) — on ne touche pas
        description = data.get("description", "")
        if "(clôturé automatiquement)" not in description:
            continue  # entrée créée à la main, pas une entrée auto-générée

        candidates = by_description.get(description, [])
        if len(candidates) == 0:
            print(f"[BACKFILL] {doc.id} : aucun trade correspondant trouvé, ignoré")
            skipped += 1
            continue
        if len(candidates) > 1:
            print(f"[BACKFILL] {doc.id} : {len(candidates)} trades correspondent, ambigu — ignoré")
            ambiguous += 1
            continue

        trade = candidates[0]
        if generate_and_attach(db, m, trade, doc.id):
            done += 1
        else:
            skipped += 1
        time.sleep(1)  # éviter de bombarder MT5/l'API en rafale

    print(f"[BACKFILL] terminé : {done} graphique(s) généré(s), {skipped} ignoré(s), {ambiguous} ambigu(s)")


if __name__ == "__main__":
    run()
