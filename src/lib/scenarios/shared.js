const CONTRACT_SIZE = 100000 // 1 lot standard = 100 000 unités de la devise de base (ex: USD pour USDJPY)
const FEE_BUFFER = 0.05 // on réduit le lot de 5% pour laisser de la marge aux commissions/spread

/**
 * Calcule la taille de position (en lots) pour risquer exactement `riskAmount`
 * (dans la devise du compte) si le prix va de `entryPrice` jusqu'à `slPrice`.
 *
 * Formule, en 3 étapes :
 *
 * 1. `distance` = écart de prix entre l'entrée et le SL (toujours positif, peu importe
 *    le sens achat/vente).
 *
 * 2. `riskPerLot` = perte en devise du compte SI on tradait 1 lot entier et que le prix
 *    touchait le SL. Pour une paire cotée en JPY (comme USDJPY) avec un compte en USD :
 *      perte_JPY = distance × CONTRACT_SIZE
 *      perte_USD = perte_JPY ÷ currentPrice   (conversion JPY → USD au cours actuel)
 *    D'où : riskPerLot = (distance × CONTRACT_SIZE) / currentPrice
 *
 * 3. `lots` = combien de lots pour que la perte totale (si le SL est touché) égale
 *    exactement `riskAmount` :
 *      lots = riskAmount / riskPerLot
 *    On réduit ensuite de 5% (FEE_BUFFER) pour ne pas dépasser le risque prévu une fois
 *    les commissions et le spread pris en compte.
 *
 * Le résultat est arrondi au centième de lot, avec un plancher de 0,01 (taille minimale
 * tradable) — même si ça peut faire dépasser légèrement le risque visé sur de très
 * petits comptes, c'est un choix assumé (voir mémoire "risk-sizing-strategy").
 *
 * @param {number} riskAmount - montant à risquer, dans la devise du compte
 * @param {number} entryPrice - prix d'entrée prévu
 * @param {number} slPrice - prix du stop loss
 * @param {number} currentPrice - prix actuel de la paire, pour la conversion de devise
 * @returns {number|null} taille de lot arrondie à 0,01, ou null si des données manquent
 */
export function computeLotSize(riskAmount, entryPrice, slPrice, currentPrice) {
  const distance = Math.abs(entryPrice - slPrice)
  if (!riskAmount || !distance || !currentPrice) return null

  const riskPerLot = (distance * CONTRACT_SIZE) / currentPrice
  if (!riskPerLot) return null

  const lots = (riskAmount / riskPerLot) * (1 - FEE_BUFFER)
  return Math.max(0.01, Math.round(lots * 100) / 100)
}
