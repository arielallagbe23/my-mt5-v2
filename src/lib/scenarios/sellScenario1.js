import { computeLotSize } from './shared'

export const id = 'sell-1'
export const label = 'Vente — Scénario 1'

/**
 * Scénario Vente 1.
 *
 * Condition d'entrée (les DEUX doivent être vraies) :
 *   1. close de la bougie de référence <= "condition de prix" choisie
 *   2. open de cette même bougie >= borne haute de la golden zone
 *      (golden zone = entre les niveaux 23,6% du Fibo 1 et du Fibo 2)
 *
 * Si les deux sont vraies → on place un Sell Limit :
 *   - Entrée = "Prix support intéressant" (saisi à la main)
 *   - SL     = niveau -0,05% du Fibo 1
 *   - TP     = niveau 58,8% du Fibo 1
 *
 * Pourquoi le CLOSE de la bougie et pas un prix live ?
 * Un aller-retour vers le VPS pour lire le prix instantané prend plusieurs secondes
 * (le VPS ne répond que toutes les ~10s). Pendant ce temps le marché peut bouger, donc
 * comparer contre un prix "live" au moment de la décision est risqué. Le close, lui, est
 * une valeur figée et déjà connue à l'avance — aucun risque de timing.
 *
 * @param {object} params
 * @param {{open:number, close:number}} params.candle - bougie de référence déjà récupérée
 * @param {{low:number, high:number}} params.fibo236Bounds - bornes de la golden zone
 * @param {number|string} params.priceCondition - seuil de comparaison sur le close
 * @param {number|string} params.supportPrice - prix d'entrée du Sell Limit
 * @param {number} params.sl2 - niveau -0,05% du Fibo 1 (utilisé comme SL)
 * @param {number} params.tp1 - niveau 58,8% du Fibo 1 (utilisé comme TP)
 * @param {number} params.riskAmount - montant risqué (en devise du compte), déjà calculé
 * @returns {object} { matched: false, reason } si la condition n'est pas remplie,
 *                    { matched: true, orderType, entry, sl, tp, lot } sinon
 */
export function evaluate({ candle, fibo236Bounds, priceCondition, supportPrice, sl2, tp1, riskAmount }) {
  // --- Garde-fous : on a besoin de toutes ces données avant de pouvoir évaluer quoi que ce soit ---
  if (!candle) return { matched: false, reason: "Récupère la bougie de référence d'abord." }
  if (!fibo236Bounds) return { matched: false, reason: 'Renseigne les niveaux Fibo 1 et 2 d\'abord.' }

  const threshold = parseFloat(priceCondition)
  if (!Number.isFinite(threshold)) return { matched: false, reason: 'Renseigne la condition de prix.' }
  if (!supportPrice) return { matched: false, reason: 'Renseigne le prix support intéressant.' }
  if (sl2 == null || tp1 == null) {
    return { matched: false, reason: 'SL/TP indisponibles — vérifie les niveaux Fibo 1.' }
  }
  if (riskAmount == null) return { matched: false, reason: 'Choisis un risque d\'abord.' }

  // --- Les deux conditions du scénario ---
  const closeBelowThreshold = candle.close <= threshold
  const openAboveGoldenZone = candle.open >= fibo236Bounds.high

  if (!(closeBelowThreshold && openAboveGoldenZone)) {
    return {
      matched: false,
      reason: `Condition non remplie (close bougie ${candle.close.toFixed(3)}, open bougie ${candle.open.toFixed(3)}).`,
    }
  }

  const entryPrice = parseFloat(supportPrice)

  // --- Garde-fou de sécurité : un Sell Limit n'a de sens que si SL > Entrée > TP. ---
  // Si les niveaux Fibo sont mal configurés (ex: inversés), on bloque plutôt que
  // d'envoyer un ordre incohérent qui exposerait à un risque mal calculé.
  if (!(sl2 > entryPrice && entryPrice > tp1)) {
    return {
      matched: false,
      reason: `Ordre incohérent (SL ${sl2.toFixed(3)} / Entrée ${entryPrice.toFixed(3)} / TP ${tp1.toFixed(3)}) — il faut SL > Entrée > TP. Vérifie tes niveaux Fibo.`,
    }
  }

  // --- Taille de position, calculée à partir du risque choisi et de la distance entrée→SL ---
  const lot = computeLotSize(riskAmount, entryPrice, sl2, candle.close)

  return {
    matched: true,
    orderType: 'Sell Limit',
    entry: entryPrice.toFixed(3),
    sl: sl2.toFixed(3),
    tp: tp1.toFixed(3),
    lot: lot != null ? lot.toFixed(2) : '—',
  }
}
