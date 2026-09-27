import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { PAGE, PAGE_TITLE } from "../lib/layout";
import { requestAndPoll, isFreshTs } from "../lib/onDemand";
import { formatExecutionTime } from "../lib/positions";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Bonjour";
  if (hour < 18) return "Bon après-midi";
  return "Bonsoir";
}

function formatPrice(value) {
  return typeof value === "number" ? value.toFixed(3) : "—";
}

// Créneaux standard des sessions FX en heure UTC — pur calcul horaire, aucune
// donnée à collecter côté VPS.
const SESSION_WINDOWS = [
  { name: "Tokyo", start: 0, end: 9 },
  { name: "Londres", start: 8, end: 17 },
  { name: "New York", start: 13, end: 22 },
];

function getActiveSessions(date) {
  const hour = date.getUTCHours();
  return SESSION_WINDOWS.filter((s) => hour >= s.start && hour < s.end).map(
    (s) => s.name,
  );
}

// La synthèse (09_bilan_quotidien.py, générée par Claude) contient déjà des
// sauts de ligne entre paragraphes (\n\n) — juste jamais rendus tels quels
// par le HTML, qui les collabore par défaut. `#+` en tête de paragraphe =
// un titre markdown que le modèle ajoute parfois malgré la consigne "texte
// brut" du prompt ; on le retire plutôt que d'afficher le dièse tel quel.
function synthesisParagraphs(text) {
  if (!text) return [];
  return text
    .split(/\n{2,}/)
    .map((p) => p.replace(/^#+\s*/, "").trim())
    .filter(Boolean);
}

function formatUpdatedAt(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function formatEventDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isToday(value) {
  if (!value) return false;
  return new Date(value).toDateString() === new Date().toDateString();
}

// Indicateur à 3 points façon Forex Factory : le nombre de points remplis
// encode le niveau d'impact (Low=1, Medium=2, High=3), d'un coup d'œil.
const IMPACT_LEVELS = { Low: 1, Medium: 2, High: 3 };
const IMPACT_DOT_COLOR = {
  High: "bg-red-400",
  Medium: "bg-amber-400",
  Low: "bg-slate-400",
};

function ImpactDots({ impact }) {
  const filled = IMPACT_LEVELS[impact] ?? 0;
  const color = IMPACT_DOT_COLOR[impact] ?? "bg-slate-500";
  return (
    <span className="flex shrink-0 items-center gap-0.5" title={impact}>
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${i <= filled ? color : "bg-white/10"}`}
        />
      ))}
    </span>
  );
}

const RISK_LEVEL_STYLES = {
  élevé: "bg-red-500/15 text-red-300",
  modéré: "bg-amber-500/15 text-amber-300",
  faible: "bg-green-500/15 text-green-300",
};

const SENTIMENT_STYLES = {
  "risk-off": "bg-red-500/15 text-red-300",
  "risk-on": "bg-green-500/15 text-green-300",
  neutre: "bg-slate-500/15 text-slate-300",
};

const TREND_STYLES = {
  haussière: "bg-emerald-500/15 text-emerald-300",
  baissière: "bg-red-500/15 text-red-300",
  range: "bg-slate-500/15 text-slate-300",
};

const CONFIRMATION_STYLES = {
  confirmé: "bg-green-500/15 text-green-300",
  divergent: "bg-amber-500/15 text-amber-300",
  indéterminée: "bg-slate-500/15 text-slate-300",
};

const SETUP_STYLES = {
  achat: "bg-emerald-500/15 text-emerald-300",
  vente: "bg-red-500/15 text-red-300",
  aucun: "bg-slate-500/15 text-slate-300",
};

const CORRELATION_STYLES = {
  "forte positive": "bg-emerald-500/15 text-emerald-300",
  positive: "bg-emerald-500/15 text-emerald-300",
  faible: "bg-slate-500/15 text-slate-300",
  négative: "bg-red-500/15 text-red-300",
  "forte négative": "bg-red-500/15 text-red-300",
};

// Tant qu'une tâche n'a pas encore été évaluée (brouillon ou en attente),
// elle est "à venir" — une fois passée en dry_run_done/done, elle a déjà son
// propre rapport dans la liste des tâches, pas besoin de la garder ici.
const UPCOMING_STATUSES = new Set(["draft", "pending"]);

export function HomePage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reports, setReports] = useState([]);
  const [upcomingTasks, setUpcomingTasks] = useState([]);
  const [marketRecap, setMarketRecap] = useState({});
  const [recapRefreshing, setRecapRefreshing] = useState(false);
  const [recapRefreshError, setRecapRefreshError] = useState("");
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  function load() {
    setError("");
    setLoading(true);
    requestAndPoll({
      request: () => api.requestPositions(),
      fetch: () => api.positions(),
      isFresh: isFreshTs,
    })
      .then((result) => {
        if (!result) {
          setError(
            "VPS indisponible — impossible de récupérer les ordres/positions",
          );
          return;
        }
        setData(result);
      })
      .finally(() => setLoading(false));
    api
      .marketRecap()
      .then(setMarketRecap)
      .catch(() => {});
  }

  useEffect(() => {
    load();
    api
      .reports()
      .then(setReports)
      .catch(() => {});
    api
      .listTasks()
      .then((tasks) =>
        setUpcomingTasks(
          tasks
            .filter((t) => UPCOMING_STATUSES.has(t.status))
            .sort((a, b) =>
              (a.executionTime ?? "").localeCompare(b.executionTime ?? ""),
            ),
        ),
      )
      .catch(() => {});
  }, []);

  async function archiveReport(id) {
    setReports((current) => current.filter((r) => r.id !== id));
    try {
      await api.archiveReport(id);
    } catch {
      api
        .reports()
        .then(setReports)
        .catch(() => {});
    }
  }

  async function refreshMarketRecap() {
    setRecapRefreshing(true);
    setRecapRefreshError("");
    // Les 9 scripts VPS peuvent prendre jusqu'à ~2 min au total (retries
    // inclus) — fenêtre de poll plus large que les autres requêtes on-demand.
    const result = await requestAndPoll({
      request: () => api.requestMarketRecapRefresh(),
      fetch: () => api.marketRecapRefreshStatus(),
      isFresh: isFreshTs,
      attempts: 40,
      delayMs: 3000,
    });
    if (result) {
      if (result.failed?.length > 0) {
        setRecapRefreshError(
          `${result.failed.length}/9 sections n'ont pas pu être actualisées.`,
        );
      }
      api
        .marketRecap()
        .then(setMarketRecap)
        .catch(() => {});
    } else {
      setRecapRefreshError("VPS indisponible — actualisation impossible");
    }
    setRecapRefreshing(false);
  }

  const positions = data?.positions ?? [];
  const fedBoj = marketRecap["01_taux_fed_boj"];
  const calendarEco = marketRecap["02_calendrier_eco"];
  const interventionRisk = marketRecap["03_risque_intervention"];
  const riskSentiment = marketRecap["04_sentiment_risk_on_off"];
  const structureD1 = marketRecap["05_structure_d1"];
  const confirmationH4 = marketRecap["06_confirmation_h4"];
  const setupH1 = marketRecap["07_setup_h1"];
  const activeSessions = getActiveSessions(now);
  const correlation10y = marketRecap["08_correlation_10y"];
  const bilanQuotidien = marketRecap["09_bilan_quotidien"];
  const netVolume = positions.reduce(
    (sum, p) => sum + (p.type === "Sell" ? -p.volume : p.volume),
    0,
  );
  const totalFloatingPnl = positions.reduce(
    (sum, p) => sum + (typeof p.profit === "number" ? p.profit : 0),
    0,
  );
  const activityCount = upcomingTasks.length + positions.length + reports.length;

  return (
    <div className={`${PAGE} lg:max-w-max`}>
      <div className="-mb-1 flex items-start justify-between gap-3">
        <div>
          <h1 className={PAGE_TITLE}>{greeting()}</h1>
          <p className="mt-1 text-sm text-slate-400">
            {activityCount === 0
              ? "Tout est calme — rien en cours pour le moment."
              : `${activityCount} élément${activityCount > 1 ? "s" : ""} à suivre aujourd'hui.`}
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="min-h-9 shrink-0 rounded-full bg-amber-500/15 px-4 text-sm font-semibold text-amber-300 disabled:opacity-60"
        >
          {loading ? "Actualisation..." : "Actualiser"}
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-12 lg:gap-2">
        {reports.length > 0 && (
          <section className="mt-5 lg:mt-0 flex flex-col gap-2 rounded-sm border border-white/10 bg-white/5 p-4 lg:col-span-12">
            <p className="text-xs font-bold tracking-[0.14em] text-slate-500 uppercase">
              Tâches non exécutées ({reports.length})
            </p>
            {reports.map((r) => (
              <div
                key={r.id}
                className="rounded-sm border border-white/10 bg-white/5 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm text-white">
                      {r.scenario === "sell" ? "Vente" : "Achat"} {r.timeframe}{" "}
                      — {formatExecutionTime(r.executionTime)}
                    </p>
                    <p className="mt-2 text-xs text-slate-400">
                      L'heure est arrivée mais {r.reason?.toLowerCase()} — tâche
                      supprimée.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => archiveReport(r.id)}
                    className="min-h-8 shrink-0 rounded-full border border-white/10 px-3 text-xs font-semibold text-slate-300"
                  >
                    Archiver
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}

        <section className="mt-5 lg:mt-0 flex flex-col gap-2 rounded-sm border border-white/10 bg-white/5 p-4 lg:col-span-4">
          <p className="text-xs font-bold tracking-[0.14em] text-slate-500 uppercase">
            Tâches à venir{" "}
            {upcomingTasks.length > 0 && `(${upcomingTasks.length})`}
          </p>
          {upcomingTasks.length === 0 && (
            <p className="text-sm text-slate-400">Aucune tâche à venir.</p>
          )}
          {upcomingTasks.map((t) => (
            <div
              key={t.id}
              className="rounded-sm border border-white/10 bg-white/5 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    t.scenario === "sell"
                      ? "bg-red-500/15 text-red-300"
                      : t.scenario === "buy"
                        ? "bg-emerald-500/15 text-emerald-300"
                        : "bg-white/10 text-slate-300"
                  }`}
                >
                  {t.scenario === "sell"
                    ? "Vendre"
                    : t.scenario === "buy"
                      ? "Acheter"
                      : "Brouillon"}
                </span>
                <span className="text-xs text-slate-400">
                  {formatExecutionTime(t.executionTime)}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <div className="flex flex-col items-center gap-0.5 rounded-sm bg-white/5 p-2 text-center">
                  <span className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
                    Timeframe
                  </span>
                  <span className="text-sm font-semibold text-white">
                    {t.timeframe ?? "—"}
                  </span>
                </div>
                <div className="flex flex-col items-center gap-0.5 rounded-sm bg-white/5 p-2 text-center">
                  <span className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
                    Risque
                  </span>
                  <span className="text-sm font-semibold text-white">
                    {t.risk != null ? `${t.risk}%` : "—"}
                  </span>
                </div>
                <div className="flex flex-col items-center gap-0.5 rounded-sm bg-white/5 p-2 text-center">
                  <span className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
                    Statut
                  </span>
                  <span className="text-sm font-semibold text-white">
                    {t.status === "draft" ? "Brouillon" : "En attente"}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </section>

        <section className="mt-5 lg:mt-0 flex flex-col gap-1 rounded-sm border border-white/10 bg-white/5 p-4 lg:col-span-12 space-y-1">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-bold tracking-[0.14em] text-slate-500 uppercase">
              Market recap
            </p>
            <button
              type="button"
              onClick={refreshMarketRecap}
              disabled={recapRefreshing}
              className="min-h-8 shrink-0 rounded-full bg-white/10 px-3 text-xs font-semibold text-slate-300 disabled:opacity-60"
            >
              {recapRefreshing ? "Actualisation..." : "Actualiser"}
            </button>
          </div>
          {recapRefreshError && (
            <p className="text-xs text-red-400">{recapRefreshError}</p>
          )}
          <div className="flex flex-col gap-2 lg:flex-row">
            <div className="w-full rounded-sm border border-white/10 bg-white/5 p-4 lg:w-[calc(33.333%-0.333rem)] space-y-4">
              <p className="text-sm font-semibold text-white">
                Différentiel de taux Fed/BoJ
              </p>
              {!fedBoj && (
                <p className="text-sm text-slate-400">
                  Aucune donnée pour le moment.
                </p>
              )}
              {fedBoj && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-sm border border-white/10 bg-white/5 p-2.5">
                      <p className="text-xs text-slate-400">Taux Fed</p>
                      <p className="text-sm font-semibold text-white">
                        {fedBoj.fed_funds_rate?.valeur != null
                          ? `${fedBoj.fed_funds_rate.valeur}%`
                          : "—"}
                      </p>
                      <p className="text-xs text-slate-500">
                        {fedBoj.fed_funds_rate?.date ?? "—"}
                      </p>
                    </div>
                    <div className="rounded-sm border border-white/10 bg-white/5 p-2.5">
                      <p className="text-xs text-slate-400">
                        Rendement 10 ans US
                      </p>
                      <p className="text-sm font-semibold text-white">
                        {fedBoj.us_10y_yield?.valeur != null
                          ? `${fedBoj.us_10y_yield.valeur}%`
                          : "—"}
                      </p>
                      <p className="text-xs text-slate-500">
                        {fedBoj.us_10y_yield?.date ?? "—"}
                      </p>
                    </div>
                  </div>
                  {fedBoj.recent_headlines?.length > 0 && (
                    <div className="mt-1 flex flex-col gap-1.5">
                      <p className="text-xs text-slate-400">Actus Fed/BoJ</p>
                      {fedBoj.recent_headlines.map((headline, index) => (
                        <p
                          key={index}
                          className="text-justify text-xs text-slate-300"
                        >
                          {headline}
                        </p>
                      ))}
                    </div>
                  )}
                  <p className="mt-1 text-xs text-slate-500">
                    Mis à jour : {formatUpdatedAt(fedBoj.updated_at)}
                  </p>
                </>
              )}
            </div>
            <div className="w-full rounded-sm border border-white/10 bg-white/5 p-4 lg:w-[calc(33.333%-0.333rem)]">
              <div className="flex items-center justify-between gap-2 space-y-4">
                <p className="text-sm font-semibold text-white">
                  Risque d'intervention BoJ/MoF
                </p>
                {interventionRisk && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${
                      RISK_LEVEL_STYLES[interventionRisk.niveau_risque] ??
                      RISK_LEVEL_STYLES.faible
                    }`}
                  >
                    {interventionRisk.niveau_risque}
                  </span>
                )}
              </div>
              {!interventionRisk && (
                <p className="text-sm text-slate-400">
                  Aucune donnée pour le moment.
                </p>
              )}
              {interventionRisk && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-sm border border-white/10 bg-white/5 p-2.5">
                      <p className="text-xs text-slate-400">Prix actuel</p>
                      <p className="text-sm font-semibold text-white">
                        {formatPrice(interventionRisk.prix_actuel)}
                      </p>
                      <p className="text-xs text-slate-500">
                        Seuil de vigilance :{" "}
                        {formatPrice(interventionRisk.seuil_vigilance)}
                      </p>
                    </div>
                    <div className="rounded-sm border border-white/10 bg-white/5 p-2.5">
                      <p className="text-xs text-slate-400">
                        Variation 5 jours
                      </p>
                      <p className="text-sm font-semibold text-white">
                        {interventionRisk.variation_5j_pct >= 0 ? "+" : ""}
                        {interventionRisk.variation_5j_pct}%
                      </p>
                      <p className="text-xs text-slate-500">
                        {interventionRisk.mouvement_rapide
                          ? "Jugé rapide"
                          : "Rythme normal"}
                      </p>
                    </div>
                  </div>
                  {interventionRisk.declarations_recentes?.length > 0 && (
                    <div className="mt-1 flex flex-col gap-1.5">
                      <p className="text-xs text-slate-400">
                        Déclarations récentes
                      </p>
                      {interventionRisk.declarations_recentes.map(
                        (headline, index) => (
                          <p
                            key={index}
                            className="text-justify text-xs text-slate-300"
                          >
                            {headline}
                          </p>
                        ),
                      )}
                    </div>
                  )}
                  <p className="mt-1 text-xs text-slate-500">
                    Mis à jour :{" "}
                    {formatUpdatedAt(interventionRisk.updated_at)}
                  </p>
                </>
              )}
            </div>
            <div className="w-full rounded-sm border border-white/10 bg-white/5 p-4 lg:w-[calc(33.333%-0.333rem)] space-y-4">
              <p className="text-sm font-semibold text-white">
                Calendrier économique
              </p>
              {!calendarEco && (
                <p className="text-sm text-slate-400">
                  Aucune donnée pour le moment.
                </p>
              )}
              {calendarEco && (
                <>
                  {calendarEco.evenements_de_la_semaine?.length > 0 ? (
                    <div className="flex flex-col gap-1.5">
                      {calendarEco.evenements_de_la_semaine.map(
                        (evt, index) => {
                          const today = isToday(evt.date);
                          return (
                            <div
                              key={index}
                              className={`grid grid-cols-[auto_auto_auto_1fr] items-center gap-2 rounded-lg px-2 py-1 text-xs ${
                                today ? "bg-amber-500/10" : ""
                              }`}
                            >
                              <span
                                className={`rounded-full px-2 py-0.5 text-center font-semibold ${
                                  evt.impact === "High"
                                    ? "bg-red-500/15 text-red-300"
                                    : "bg-amber-500/15 text-amber-300"
                                }`}
                              >
                                {evt.devise}
                              </span>
                              <ImpactDots impact={evt.impact} />
                              <span className="whitespace-nowrap text-slate-500">
                                {formatEventDate(evt.date)}
                              </span>
                              <span
                                className={
                                  today
                                    ? "font-semibold text-white"
                                    : "text-slate-300"
                                }
                              >
                                {evt.evenement}
                              </span>
                            </div>
                          );
                        },
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400">
                      Aucun événement à impact élevé/moyen cette semaine.
                    </p>
                  )}
                  <p className="mt-1 text-xs text-slate-500">
                    Mis à jour : {formatUpdatedAt(calendarEco.updated_at)}
                  </p>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2 lg:flex-row">
            <div className="w-full rounded-sm border border-white/10 bg-white/5 p-4 lg:w-[calc(28.571%-0.375rem)] space-y-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-white">
                  Sentiment risk-on/risk-off
                </p>
                {riskSentiment && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${
                      SENTIMENT_STYLES[riskSentiment.sentiment] ??
                      SENTIMENT_STYLES.neutre
                    }`}
                  >
                    {riskSentiment.sentiment}
                  </span>
                )}
              </div>
              {!riskSentiment && (
                <p className="text-sm text-slate-400">
                  Aucune donnée pour le moment.
                </p>
              )}
              {riskSentiment && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-sm border border-white/10 bg-white/5 p-2.5">
                      <p className="text-xs text-slate-400">VIX</p>
                      <p className="text-sm font-semibold text-white">
                        {riskSentiment.vix}
                      </p>
                    </div>
                    <div className="rounded-sm border border-white/10 bg-white/5 p-2.5">
                      <p className="text-xs text-slate-400">S&amp;P 500 (5j)</p>
                      <p className="text-sm font-semibold text-white">
                        {riskSentiment.sp500_variation_5j_pct >= 0 ? "+" : ""}
                        {riskSentiment.sp500_variation_5j_pct}%
                      </p>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Mis à jour : {formatUpdatedAt(riskSentiment.updated_at)}
                  </p>
                </>
              )}
            </div>

            <div className="w-full rounded-sm border border-white/10 bg-white/5 p-4 lg:w-[calc(28.571%-0.375rem)] space-y-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-white">Structure D1</p>
                {structureD1 && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${
                      TREND_STYLES[structureD1.tendance] ?? TREND_STYLES.range
                    }`}
                  >
                    {structureD1.tendance}
                  </span>
                )}
              </div>
              {!structureD1 && (
                <p className="text-sm text-slate-400">
                  Aucune donnée pour le moment.
                </p>
              )}
              {structureD1 && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-sm border border-white/10 bg-white/5 p-2.5">
                      <p className="text-xs text-slate-400">Support (30j)</p>
                      <p className="text-sm font-semibold text-white">
                        {formatPrice(structureD1.support)}
                      </p>
                    </div>
                    <div className="rounded-sm border border-white/10 bg-white/5 p-2.5">
                      <p className="text-xs text-slate-400">Résistance (30j)</p>
                      <p className="text-sm font-semibold text-white">
                        {formatPrice(structureD1.resistance)}
                      </p>
                    </div>
                    <div className="rounded-sm border border-white/10 bg-white/5 p-2.5">
                      <p className="text-xs text-slate-400">MM20 / MM50</p>
                      <p className="text-sm font-semibold text-white">
                        {formatPrice(structureD1.sma20)} /{" "}
                        {formatPrice(structureD1.sma50)}
                      </p>
                    </div>
                    <div className="rounded-sm border border-white/10 bg-white/5 p-2.5">
                      <p className="text-xs text-slate-400">Dernière bougie</p>
                      <p className="text-sm font-semibold text-white capitalize">
                        {structureD1.biais_derniere_bougie}
                      </p>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Mis à jour : {formatUpdatedAt(structureD1.updated_at)}
                  </p>
                </>
              )}
            </div>

            <div className="w-full rounded-sm border border-white/10 bg-white/5 p-4 lg:w-[calc(28.571%-0.375rem)] space-y-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-white">H4 vs D1</p>
                {confirmationH4 && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${
                      CONFIRMATION_STYLES[confirmationH4.confirmation] ??
                      CONFIRMATION_STYLES.indéterminée
                    }`}
                  >
                    {confirmationH4.confirmation}
                  </span>
                )}
              </div>
              {!confirmationH4 && (
                <p className="text-sm text-slate-400">
                  Aucune donnée pour le moment.
                </p>
              )}
              {confirmationH4 && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-sm border border-white/10 bg-white/5 p-2.5">
                      <p className="text-xs text-slate-400">Tendance D1</p>
                      <p className="text-sm font-semibold text-white capitalize">
                        {confirmationH4.tendance_d1}
                      </p>
                    </div>
                    <div className="rounded-sm border border-white/10 bg-white/5 p-2.5">
                      <p className="text-xs text-slate-400">Tendance H4</p>
                      <p className="text-sm font-semibold text-white capitalize">
                        {confirmationH4.tendance_h4}
                      </p>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Mis à jour : {formatUpdatedAt(confirmationH4.updated_at)}
                  </p>
                </>
              )}
            </div>

            <div className="w-full rounded-sm border border-white/10 bg-white/5 p-4 lg:w-[calc(14.286%-0.375rem)]">
              <div className="flex flex-col items-start gap-1.5">
                <p className="text-sm font-semibold text-white">
                  Session active
                </p>
                {activeSessions.length > 1 && (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-300">
                    Chevauchement
                  </span>
                )}
              </div>
              {activeSessions.length === 0 ? (
                <p className="mt-2 text-sm text-slate-400">
                  Aucune session majeure active.
                </p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {activeSessions.map((session) => (
                    <span
                      key={session}
                      className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-300"
                    >
                      {session}
                    </span>
                  ))}
                </div>
              )}
              <p className="mt-1 text-xs text-slate-500">
                Heure UTC :{" "}
                {now.toLocaleTimeString("fr-FR", {
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "UTC",
                })}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2 lg:flex-row">
            <div className="w-full rounded-sm border border-white/10 bg-white/5 p-4 lg:w-[calc(25%-0.333rem)]">
              <div className="flex items-center justify-between gap-2 space-y-2">
                <p className="text-sm font-semibold text-white">
                  Setup d'entrée H1
                </p>
                {setupH1 && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize mb-2 ${
                      SETUP_STYLES[setupH1.setup] ?? SETUP_STYLES.aucun
                    }`}
                  >
                    {setupH1.setup}
                  </span>
                )}
              </div>
              {!setupH1 && (
                <p className="text-sm text-slate-400">
                  Aucune donnée pour le moment.
                </p>
              )}
              {setupH1 && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-sm border border-white/10 bg-white/5 p-2.5">
                      <p className="text-xs text-slate-400">Tendance H1</p>
                      <p className="text-sm font-semibold text-white capitalize">
                        {setupH1.tendance_h1}
                      </p>
                    </div>
                    <div className="rounded-sm border border-white/10 bg-white/5 p-2.5">
                      <p className="text-xs text-slate-400">RSI H1</p>
                      <p className="text-sm font-semibold text-white">
                        {setupH1.rsi_h1}
                      </p>
                    </div>
                    <div className="rounded-sm border border-white/10 bg-white/5 p-2.5">
                      <p className="text-xs text-slate-400">MM20 H1</p>
                      <p className="text-sm font-semibold text-white">
                        {formatPrice(setupH1.mm20_h1)}
                      </p>
                    </div>
                    <div className="rounded-sm border border-white/10 bg-white/5 p-2.5">
                      <p className="text-xs text-slate-400">Pullback MM20</p>
                      <p className="text-sm font-semibold text-white">
                        {setupH1.pullback_mm20 ? "Oui" : "Non"}
                      </p>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Mis à jour : {formatUpdatedAt(setupH1.updated_at)}
                  </p>
                </>
              )}
            </div>

            <div className="w-full rounded-sm border border-white/10 bg-white/5 p-4 lg:w-[calc(25%-0.333rem)] space-y-2">
              <p className="text-sm font-semibold text-white">
                Exposition &amp; corrélation
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-sm border border-white/10 bg-white/5 p-2.5">
                  <p className="text-xs text-slate-400">Positions ouvertes</p>
                  <p className="text-sm font-semibold text-white">
                    {positions.length}
                  </p>
                </div>
                <div className="rounded-sm border border-white/10 bg-white/5 p-2.5">
                  <p className="text-xs text-slate-400">Volume net</p>
                  <p className="text-sm font-semibold text-white">
                    {netVolume > 0 ? "+" : ""}
                    {netVolume.toFixed(2)} lot
                    {Math.abs(netVolume) > 1 ? "s" : ""}
                  </p>
                </div>
                <div className="rounded-sm border border-white/10 bg-white/5 p-2.5">
                  <p className="text-xs text-slate-400">P&amp;L flottant</p>
                  <p
                    className={`text-sm font-semibold ${totalFloatingPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}
                  >
                    {totalFloatingPnl.toFixed(2)}
                  </p>
                </div>
                <div className="rounded-sm border border-white/10 bg-white/5 p-2.5">
                  <p className="text-xs text-slate-400">
                    Corrélation 10 ans US
                  </p>
                  {correlation10y ? (
                    <span
                      className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${
                        CORRELATION_STYLES[correlation10y.lecture] ??
                        CORRELATION_STYLES.faible
                      }`}
                    >
                      {correlation10y.correlation_usdjpy_10y} (
                      {correlation10y.lecture})
                    </span>
                  ) : (
                    <p className="text-sm text-slate-400">—</p>
                  )}
                </div>
              </div>
              {correlation10y && (
                <p className="mt-1 text-xs text-slate-500">
                  Mis à jour : {formatUpdatedAt(correlation10y.updated_at)}
                </p>
              )}
            </div>

            {bilanQuotidien && (
              <div className="w-full rounded-sm border border-white/10 bg-white/5 p-4 lg:w-[calc(50%-0.333rem)]">
                <p className="mb-3 rounded-sm font-bold">Bilan</p>
                <div className="flex flex-col gap-3">
                  {synthesisParagraphs(bilanQuotidien.synthese).map(
                    (paragraph, index) => (
                      <p
                        key={index}
                        className="text-justify text-sm leading-[1.5] text-white"
                      >
                        {paragraph}
                      </p>
                    ),
                  )}
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Mis à jour : {formatUpdatedAt(bilanQuotidien.updated_at)}
                </p>
              </div>
            )}
          </div>
        </section>

      </div>
    </div>
  );
}
