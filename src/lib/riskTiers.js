// Calcul du risque automatique par palier, selon la croissance de l'équité
// live par rapport au capital de référence fixe (account_size — jamais
// l'équité elle-même comme base, voir la mémoire risk-sizing-strategy).
//
// Règle (paliers ascendants, ex. par défaut) :
//   croissance <= +1%          -> 0,5%
//   +1% < croissance < +2%     -> 1%
//   croissance >= +2%          -> 2% (plafond, ne monte jamais plus haut)
//
// Chaque palier "réclame" la croissance <= son seuil, SAUF le dernier palier
// avant le plafond, qui est strict (<) : pile au seuil, c'est déjà le
// plafond qui s'applique — c'est ce qui donne "à +2% on met 2%" plutôt que
// le palier des +1%.

export const DEFAULT_RISK_TIERS = [
  { threshold: 1, risk: 0.5 },
  { threshold: 2, risk: 1 },
]
export const DEFAULT_CAP_RISK = 2

export function computeGrowthPercent(equity, accountSize) {
  if (typeof equity !== 'number' || !accountSize) return null
  return ((equity - accountSize) / accountSize) * 100
}

export function computeAutoRisk(growthPercent, tiers, capRisk) {
  if (typeof growthPercent !== 'number') return null
  const sorted = [...(tiers ?? [])].sort((a, b) => a.threshold - b.threshold)

  for (let i = 0; i < sorted.length; i++) {
    const tier = sorted[i]
    const isLast = i === sorted.length - 1
    if (isLast) {
      if (growthPercent < tier.threshold) return tier.risk
    } else if (growthPercent <= tier.threshold) {
      return tier.risk
    }
  }
  return capRisk ?? DEFAULT_CAP_RISK
}
