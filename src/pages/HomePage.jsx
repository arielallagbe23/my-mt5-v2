import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { PAGE } from '../lib/layout'
import { requestAndPoll, isFreshTs } from '../lib/onDemand'

function formatPrice(value) {
  return typeof value === 'number' ? value.toFixed(3) : '—'
}

export function HomePage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  function load() {
    setError('')
    setLoading(true)
    requestAndPoll({
      request: () => api.requestPositions(),
      fetch: () => api.positions(),
      isFresh: isFreshTs,
    })
      .then((result) => {
        if (!result) {
          setError('VPS indisponible — impossible de récupérer les ordres/positions')
          return
        }
        setData(result)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  const orders = data?.orders ?? []
  const positions = data?.positions ?? []

  return (
    <div className={PAGE}>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="min-h-9 rounded-full bg-indigo-500/15 px-4 text-sm font-semibold text-indigo-300 disabled:opacity-60"
        >
          {loading ? 'Actualisation...' : 'Actualiser'}
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <section className="flex flex-col gap-2">
        <p className="text-xs font-bold tracking-[0.14em] text-slate-500 uppercase">Ordres différés</p>
        {loading && !data && <p className="text-sm text-slate-400">Chargement...</p>}
        {!loading && orders.length === 0 && <p className="text-sm text-slate-400">Aucun ordre en attente.</p>}
        {orders.map((o) => (
          <div key={o.ticket} className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="flex items-center justify-between gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  o.type?.includes('Sell') ? 'bg-red-500/15 text-red-300' : 'bg-blue-500/15 text-blue-300'
                }`}
              >
                {o.type}
              </span>
              <span className="text-xs text-slate-400">{o.symbol}</span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-400">
              <span>
                Prix : <span className="font-semibold text-white">{formatPrice(o.price)}</span>
              </span>
              <span>
                SL : <span className="font-semibold text-white">{formatPrice(o.sl)}</span>
              </span>
              <span>
                TP : <span className="font-semibold text-white">{formatPrice(o.tp)}</span>
              </span>
            </div>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <p className="text-xs font-bold tracking-[0.14em] text-slate-500 uppercase">Positions ouvertes</p>
        {loading && !data && <p className="text-sm text-slate-400">Chargement...</p>}
        {!loading && positions.length === 0 && <p className="text-sm text-slate-400">Aucune position ouverte.</p>}
        {positions.map((p) => (
          <div key={p.ticket} className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="flex items-center justify-between gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  p.type === 'Sell' ? 'bg-red-500/15 text-red-300' : 'bg-blue-500/15 text-blue-300'
                }`}
              >
                {p.type}
              </span>
              <span
                className={`text-sm font-semibold ${
                  typeof p.profit === 'number' && p.profit >= 0 ? 'text-green-400' : 'text-red-400'
                }`}
              >
                {typeof p.profit === 'number' ? p.profit.toFixed(2) : '—'}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-400">
              <span>
                Entrée : <span className="font-semibold text-white">{formatPrice(p.priceOpen)}</span>
              </span>
              <span>
                Actuel : <span className="font-semibold text-white">{formatPrice(p.priceCurrent)}</span>
              </span>
              <span>
                Volume : <span className="font-semibold text-white">{p.volume}</span>
              </span>
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}
