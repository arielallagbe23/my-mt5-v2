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
