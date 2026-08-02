"""
buy_1.py — Sous-cas Achat 1 : l'open de la bougie qui vient de s'ouvrir est
en dessous (ou à) la borne basse de la golden zone. Le routeur
(scenarios.py) a déjà vérifié cette position avant d'appeler cette
fonction — elle ne fait que construire l'ordre.
"""

from scenario_shared import compute_lot_size, fibo_price


def evaluate_buy_1(task, candle, account_size):
    """Entrée = "prix support/résistance intéressant" saisi à la main sur la
    tâche (PAS calculé depuis la golden zone, contrairement à Buy 2/3/4).
    SL = niveau -0,05% du Fibo 1, TP = niveau 58,8% du Fibo 1 — mêmes niveaux
    numériques que Sell 1, mais qui donnent un SL en dessous et un TP au
    dessus grâce à la saisie non-inversée du Fibo 1 pour un achat.
    """
    fibo100 = task["fibo100"]
    fibo0 = task["fibo0"]

    sl = fibo_price(fibo100, fibo0, -0.05)  # niveau -0,05% du Fibo 1 -> stop loss
    tp = fibo_price(fibo100, fibo0, 0.588)  # niveau 58,8% du Fibo 1 -> take profit
    entry_price = task["supportPrice"]

    # --- Garde-fou de sécurité : un Buy Limit n'a de sens que si SL < Entrée < TP. ---
    if not (sl < entry_price < tp):
        return {
            "matched": False,
            "reason": f"Ordre incohérent (SL {sl} / Entrée {entry_price} / TP {tp})",
        }

    risk_amount = (task["risk"] / 100) * account_size if account_size else None
    lot = compute_lot_size(risk_amount, entry_price, sl, candle["close"])

    return {
        "matched": True,
        "orderType": "Buy Limit",
        "entry": entry_price,
        "sl": sl,
        "tp": tp,
        "lot": lot,
    }
