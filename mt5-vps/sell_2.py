"""
sell_2.py — Scénario Vente 2 (scenarioId "sell-2").
"""

from scenario_shared import compute_lot_size, fibo_price


def evaluate_sell_2(task, candle, account_size):
    """Condition d'entrée : le close de la bougie de référence est dans la
    moitié HAUTE de la golden zone (entre son milieu et sa borne haute, sans
    la dépasser) :

      milieu_golden_zone < close_bougie < borne_haute_golden_zone

    (rappel golden zone = zone entre les niveaux 23,6% du Fibo 1 et du Fibo 2 ;
    borne haute = le plus grand des deux, borne basse = le plus petit)

    Si vraie → on place un Sell Limit :
      - Entrée = borne haute du range (PAS le "prix support" saisi à la main —
        ce champ existe sur la tâche mais n'est utilisé que par Sell 1)
      - SL     = SL1 = niveau 80% du Fibo 2
      - TP     = TP1 = niveau 58,8% du Fibo 1 (même TP que Sell 1)
    """
    fibo100 = task["fibo100"]  # borne haute du Fibo 1 (100%), saisie par l'utilisateur
    fibo0 = task["fibo0"]  # borne basse du Fibo 1 (0%), saisie par l'utilisateur

    fibo1_236 = fibo_price(fibo100, fibo0, 0.236)  # niveau 23,6% du Fibo 1
    tp1 = fibo_price(fibo100, fibo0, 0.588)  # niveau 58,8% du Fibo 1 -> take profit

    # Fibo 2 : 100% = fibo0 (le 0% du Fibo 1), 0% = low de la bougie de référence
    # (dérivé automatiquement, comme pour Sell 1).
    fibo2_236 = fibo_price(fibo0, candle["low"], 0.236)
    sl1 = fibo_price(fibo0, candle["low"], 0.8)  # niveau 80% du Fibo 2 -> stop loss

    golden_low = min(fibo1_236, fibo2_236)
    golden_high = max(fibo1_236, fibo2_236)
    golden_mid = (golden_low + golden_high) / 2

    # --- Condition unique du scénario ---
    close = candle["close"]
    in_upper_half = golden_mid < close < golden_high
    if not in_upper_half:
        return {
            "matched": False,
            "reason": f"Condition non remplie (close={close}, golden zone [{golden_low:.3f} / {golden_mid:.3f} / {golden_high:.3f}])",
        }

    entry_price = golden_high

    # --- Garde-fou de sécurité : un Sell Limit n'a de sens que si SL > Entrée > TP.
    # Même vérification que Sell 1. ---
    if not (sl1 > entry_price > tp1):
        return {
            "matched": False,
            "reason": f"Ordre incohérent (SL {sl1} / Entrée {entry_price} / TP {tp1})",
        }

    risk_amount = (task["risk"] / 100) * account_size if account_size else None
    lot = compute_lot_size(risk_amount, entry_price, sl1, close)

    return {
        "matched": True,
        "orderType": "Sell Limit",
        "entry": entry_price,
        "sl": sl1,
        "tp": tp1,
        "lot": lot,
    }
