import { Fragment, useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { formatDate, formatVolume, money } from './journalStats'

function formatHistoryTime(ts) {
  return typeof ts === 'number' ? new Date(ts * 1000).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—'
}

// Raison de clôture MT5 (DEAL_REASON, stocké tel quel dans trades.py) —
// CLIENT/MOBILE/WEB = fermée à la main depuis un terminal MT5, EXPERT =
// fermée par un script/API, SL/TP/STOP_OUT = déclenchement automatique.
// IMPORT = trade importé par CSV, MT5 ne fournit pas cette info dans
// l'export d'historique.
const REASON_LABELS = {
  TP: { label: 'TP touché', manual: false },
  SL: { label: 'SL touché', manual: false },
  STOP_OUT: { label: 'Stop out (marge insuffisante)', manual: false },
  CLIENT: { label: 'Fermée manuellement (terminal)', manual: true },
  MOBILE: { label: 'Fermée manuellement (mobile)', manual: true },
  WEB: { label: 'Fermée manuellement (web)', manual: true },
  EXPERT: { label: 'Fermée automatiquement (bot/EA)', manual: false },
  IMPORT: { label: 'Import CSV — raison de clôture inconnue', manual: null },
}

// EXPERT est ambigu : ça couvre aussi bien le bouton "Fermer en urgence"
// (une vraie décision de TA part, juste passée par l'app plutôt que le
// terminal — voir le commentaire "manual-close" posé par
// _handle_close_position_request dans on_demand.py) que la fermeture
// automatique d'un miroir suppléant (comment "mirror-close", voir
// _close_mirror dans mirror_follower.py). On affine avec le commentaire de
// l'ordre plutôt que de tout mettre dans le même sac "bot/EA".
const EXPERT_COMMENT_LABELS = {
  'manual-close': { label: 'Fermée manuellement (depuis l’app)', manual: true },
  'mirror-close': { label: 'Fermée automatiquement (suivi du compte principal)', manual: false },
}

function ClosureReason({ reason, comment }) {
  const info = (reason === 'EXPERT' && EXPERT_COMMENT_LABELS[comment]) || REASON_LABELS[reason]
  if (!info) return null
  return (
    <p className={`mt-1 border-t border-white/10 pt-2 text-xs font-semibold ${info.manual ? 'text-amber-400' : 'text-slate-400'}`}>
      Conclusion : {info.label}
    </p>
  )
}

function TradeRecap({ ticket, reason, comment }) {
  const [history, setHistory] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .trailingHistory(ticket)
      .then((result) => setHistory(result.history ?? []))
      .catch(() => setError('Récapitulatif indisponible'))
  }, [ticket])

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-red-400">{error}</p>}
      {!error && history === null && <p className="text-slate-500">Chargement...</p>}
      {!error && history !== null && history.length === 0 && (
        <p className="text-slate-500">Aucun suivi trailing stop enregistré pour cette position.</p>
      )}
      {!error &&
        history?.map((h, i) => {
          const isSlMove = h.message?.includes('SL est passé')
          return (
            <p key={`${h.ts}-${i}`} className={isSlMove ? 'text-indigo-300' : 'text-slate-400'}>
              <span className="text-slate-500">{formatHistoryTime(h.ts)}</span> — {h.message}
            </p>
          )
        })}
      <ClosureReason reason={reason} comment={comment} />
    </div>
  )
}

export function TransactionsTable({ trades, pageTrades, page, totalPages, onPrevPage, onNextPage }) {
  const [expandedTicket, setExpandedTicket] = useState(null)

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-bold tracking-[0.14em] text-slate-400 uppercase">Transactions</p>
        <span className="text-xs text-slate-500">{trades.length} au total</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-slate-500">
              <th className="pb-2 pr-2 font-normal">Date</th>
              <th className="pb-2 pr-2 font-normal">Type</th>
              <th className="pb-2 pr-2 font-normal">Vol.</th>
              <th className="pb-2 pr-2 font-normal">Prix</th>
              <th className="pb-2 font-normal">P&amp;L</th>
            </tr>
          </thead>
          <tbody>
            {pageTrades.map((t) => {
              const expanded = expandedTicket === t.positionId
              return (
                <Fragment key={t.positionId}>
                  <tr
                    onClick={() => setExpandedTicket(expanded ? null : t.positionId)}
                    className="cursor-pointer border-t border-white/5"
                  >
                    <td className="py-2 pr-2 whitespace-nowrap text-slate-400">{formatDate(t.closeTime)}</td>
                    <td className={`py-2 pr-2 font-semibold ${t.type === 'Sell' ? 'text-red-400' : 'text-blue-400'}`}>
                      {t.type === 'Sell' ? 'SELL' : 'BUY'}
                    </td>
                    <td className="py-2 pr-2 text-slate-300">{formatVolume(t.volume)}</td>
                    <td className="py-2 pr-2 text-slate-300">{t.priceClose}</td>
                    <td className={`py-2 font-semibold ${t.net >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
                      {money(t.net)}
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="border-t border-white/5 bg-white/5">
                      <td colSpan={5} className="p-3">
                        <p className="mb-2 text-[10px] font-bold tracking-[0.14em] text-slate-500 uppercase">
                          Récapitulatif — ticket {t.positionId}
                        </p>
                        <TradeRecap ticket={t.positionId} reason={t.reason} comment={t.comment} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between">
          <button
            type="button"
            onClick={onPrevPage}
            disabled={page === 1}
            className="min-h-8 rounded-full border border-white/10 px-3 text-xs font-semibold text-white disabled:opacity-40"
          >
            ← Préc.
          </button>
          <span className="text-xs text-slate-500">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            onClick={onNextPage}
            disabled={page === totalPages}
            className="min-h-8 rounded-full border border-white/10 px-3 text-xs font-semibold text-white disabled:opacity-40"
          >
            Suiv. →
          </button>
        </div>
      )}
    </div>
  )
}
