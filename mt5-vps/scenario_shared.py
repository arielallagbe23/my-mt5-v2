"""
scenario_shared.py — Fonctions pures utilisées par tous les scénarios (taille
de position, interpolation Fibonacci). Aucune fonction ici ne touche à MT5 ou
Firestore, ce qui les rend faciles à tester isolément.
"""

from config import CONTRACT_SIZE, FEE_BUFFER


def compute_lot_size(risk_amount, entry_price, sl_price, current_price):
    """Calcule la taille de position (en lots) pour risquer exactement `risk_amount`
    (dans la devise du compte) si le prix va de `entry_price` jusqu'à `sl_price`.

    Port direct de l'ancien src/lib/scenarios/shared.js computeLotSize (supprimé —
    ce fichier est maintenant la seule implémentation vivante, à garder cohérente
    si la formule change un jour).

    Formule, en 3 étapes :
      1. `distance` = écart de prix entre l'entrée et le SL (toujours positif, peu
         importe le sens achat/vente).
      2. `risk_per_lot` = perte en devise du compte SI on tradait 1 lot entier et que
         le prix touchait le SL. Pour une paire cotée en JPY (comme USDJPY) avec un
         compte en USD :
           perte_JPY = distance × CONTRACT_SIZE
           perte_USD = perte_JPY ÷ current_price   (conversion JPY → USD au cours actuel)
         D'où : risk_per_lot = (distance × CONTRACT_SIZE) / current_price
      3. `lots` = combien de lots pour que la perte totale (si le SL est touché) égale
         exactement `risk_amount` : lots = risk_amount / risk_per_lot
         On réduit ensuite de 5% (FEE_BUFFER) pour ne pas dépasser le risque prévu une
         fois les commissions et le spread pris en compte.

    Le résultat est arrondi au centième de lot, avec un plancher de 0,01 (taille
    minimale tradable) — même si ça peut faire dépasser légèrement le risque visé sur
    de très petits comptes, c'est un choix assumé (voir mémoire risk-sizing-strategy).

    Retourne None si une donnée manque (risk_amount/distance/current_price nul ou 0).
    """
    distance = abs(entry_price - sl_price)
    if not risk_amount or not distance or not current_price:
        return None

    risk_per_lot = (distance * CONTRACT_SIZE) / current_price
    if not risk_per_lot:
        return None

    lots = (risk_amount / risk_per_lot) * (1 - FEE_BUFFER)
    return max(0.01, round(lots, 2))


def fibo_price(hi, lo, level):
    """Prix correspondant à un niveau de retracement Fibonacci entre `lo` (0%) et
    `hi` (100%). Ex: level=0.236 -> prix à 23,6% en remontant de lo vers hi. Les
    niveaux hors [0, 1] (ex: -0.05, 1.0 utilisés ailleurs) sont valides aussi,
    c'est juste une interpolation (ou extrapolation) linéaire."""
    return lo + (hi - lo) * level


def golden_zone(fibo100, fibo0, fibo2_bound):
    """Golden zone (entre les niveaux 23,6% du Fibo 1 et du Fibo 2) + SL1/TP1,
    partagés par tous les scénarios basés sur la golden zone (Sell/Buy 2/3/4 —
    les scénarios "1" ont leur propre entrée/SL manuels).

    Fibo 2 : 100% = fibo0 (le 0% du Fibo 1), 0% = `fibo2_bound` — le **low** de
    la bougie de clôture pour un scénario de vente, le **high** pour un achat.

    Retourne (borne_basse, milieu, borne_haute, sl1, tp1). Ces mêmes niveaux
    numériques (0,236 / 0,8 / 0,588) donnent automatiquement le bon prix dans
    le bon sens pour l'achat comme pour la vente, grâce à la convention de
    saisie du Fibo 1 (inversée pour une vente, normale pour un achat).
    """
    fibo1_236 = fibo_price(fibo100, fibo0, 0.236)
    fibo2_236 = fibo_price(fibo0, fibo2_bound, 0.236)

    low = min(fibo1_236, fibo2_236)
    high = max(fibo1_236, fibo2_236)
    mid = (low + high) / 2

    sl1 = fibo_price(fibo0, fibo2_bound, 0.8)  # niveau 80% du Fibo 2
    tp1 = fibo_price(fibo100, fibo0, 0.588)  # niveau 58,8% du Fibo 1

    return low, mid, high, sl1, tp1


def finish_sell_order(entry_price, sl, tp, candle_close, task, account_size):
    """Vérifie l'ordre SL > Entrée > TP, calcule le lot, et construit le
    résultat "matched". Partagé par Sell 2/3/4 (Sell 1 a sa propre logique
    d'entrée manuelle, donc son propre code équivalent)."""
    if not (sl > entry_price > tp):
        return {
            "matched": False,
            "reason": f"Ordre incohérent (SL {sl} / Entrée {entry_price} / TP {tp})",
        }

    risk_amount = (task["risk"] / 100) * account_size if account_size else None
    lot = compute_lot_size(risk_amount, entry_price, sl, candle_close)

    return {
        "matched": True,
        "orderType": "Sell Limit",
        "entry": entry_price,
        "sl": sl,
        "tp": tp,
        "lot": lot,
    }


def finish_buy_order(entry_price, sl, tp, candle_close, task, account_size):
    """Équivalent de finish_sell_order pour un achat : vérifie SL < Entrée <
    TP (ordre inversé par rapport à la vente), calcule le lot, construit le
    résultat "matched". Partagé par Buy 2/3/4."""
    if not (sl < entry_price < tp):
        return {
            "matched": False,
            "reason": f"Ordre incohérent (SL {sl} / Entrée {entry_price} / TP {tp})",
        }

    risk_amount = (task["risk"] / 100) * account_size if account_size else None
    lot = compute_lot_size(risk_amount, entry_price, sl, candle_close)

    return {
        "matched": True,
        "orderType": "Buy Limit",
        "entry": entry_price,
        "sl": sl,
        "tp": tp,
        "lot": lot,
    }
