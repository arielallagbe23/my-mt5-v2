export function JournalHeader({ tradesCount, onExportCsv, onExportHtml, exportDisabled, onSync, syncing }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div>
        <h1 className="text-2xl font-bold text-white sm:text-3xl">Journal</h1>
        <p className="text-xs text-slate-400 my-2">
          {tradesCount === null ? '...' : `${tradesCount} trades · tout l'historique`}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onExportCsv}
          disabled={exportDisabled}
          className="min-h-9 rounded-full border border-white/10 px-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          CSV
        </button>
        <button
          type="button"
          onClick={onExportHtml}
          disabled={exportDisabled}
          className="min-h-9 rounded-full border border-white/10 px-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          HTML
        </button>
        <button
          type="button"
          onClick={onSync}
          disabled={syncing}
          className="min-h-9 rounded-full border border-white/10 px-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {syncing ? 'Synchro...' : 'Actualiser'}
        </button>
      </div>
    </div>
  )
}
