"""
trade_chart.py — Génère un graphique (bougies + zones TP/SL) pour un trade
fermé et l'attache à son entrée de journal (mistakes), via l'API Vercel
(/api/trade-chart/upload — même secret CRON_SECRET que notify.py, parce que
le token Vercel Blob n'existe que côté serveur, jamais sur le VPS).

Appelé depuis auto_journal.py::create_entry_from_trade (nouveau trade) et
depuis backfill_trade_charts.py (rattrapage des entrées déjà existantes qui
n'avaient pas encore de graphique). Dans les deux cas, une erreur ici ne
doit jamais empêcher l'entrée de journal d'exister — l'appelant isole déjà
ça dans son propre try/except.
"""

import base64
import json
import urllib.request
from datetime import datetime, timedelta, timezone
from io import BytesIO

import matplotlib

matplotlib.use("Agg")  # aucun affichage sur le VPS (service sans écran)
import matplotlib.dates as mdates
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle

from config import BACKEND_URL, CRON_SECRET
from position_shared import resolve_timeframe

TIMEFRAME_SECONDS = {"H1": 3600, "H4": 4 * 3600}
_TF_CONSTANTS = {"H1": "TIMEFRAME_H1", "H4": "TIMEFRAME_H4"}
DEFAULT_TIMEFRAME = "H4"  # même repli que order_fills.py/pending_order_watch.py

# Contexte minimum avant l'entrée, en nombre de bougies, pour un trade très
# rapide (sinon on se retrouverait avec un graphique quasi vide) — sinon
# autant de contexte que la durée réelle du trade (voir _chart_window).
MIN_CONTEXT_BARS = 10

MAX_IMAGE_BYTES = 8 * 1024 * 1024  # même limite que mistakes.js côté serveur

REASON_LABELS = {"TP": "TP hit", "SL": "SL hit"}


def _original_order_details(m, ticket):
    """SL/TP et commentaire de l'ORDRE D'ENTRÉE d'origine (le premier dans
    l'historique MT5 pour cette position), PAS ceux du deal de clôture
    (trade["comment"]) — celui-ci est souvent réécrit par MT5/le broker à
    la clôture (ex: "[sl 158.xxx]") et ferait échouer resolve_timeframe,
    qui a besoin du commentaire "task-{id}" posé à l'OUVERTURE."""
    orders = m.history_orders_get(position=ticket) or ()
    if not orders:
        return None, None, None
    first = min(orders, key=lambda o: o.time_setup)
    sl = float(first.sl) if first.sl else None
    tp = float(first.tp) if first.tp else None
    return sl, tp, first.comment


def _chart_window(open_time, close_time, timeframe):
    """Début de la plage de bougies à récupérer : autant de contexte AVANT
    l'entrée que la durée réelle du trade, avec un minimum de
    MIN_CONTEXT_BARS bougies pour qu'un trade très rapide ait quand même un
    graphique lisible."""
    duration = max(close_time - open_time, 0)
    min_context = MIN_CONTEXT_BARS * TIMEFRAME_SECONDS[timeframe]
    context = max(duration, min_context)
    return open_time - context


def _fetch_candles(m, symbol, timeframe, start_ts, end_ts):
    tf_constant = getattr(m, _TF_CONSTANTS[timeframe])
    date_from = datetime.fromtimestamp(start_ts, tz=timezone.utc)
    date_to = datetime.fromtimestamp(end_ts, tz=timezone.utc) + timedelta(seconds=1)
    rates = m.copy_rates_range(symbol, tf_constant, date_from, date_to)
    return rates if rates is not None else ()


def _render_png(trade, candles, timeframe, entry, sl, tp):
    is_buy = trade["type"] == "Buy"
    width = timedelta(seconds=TIMEFRAME_SECONDS[timeframe] * 0.6)

    fig, ax = plt.subplots(figsize=(9, 6), facecolor="#0d1117")
    ax.set_facecolor("#0d1117")

    for c in candles:
        t = datetime.fromtimestamp(int(c["time"]), tz=timezone.utc)
        o, h, l, close = float(c["open"]), float(c["high"]), float(c["low"]), float(c["close"])
        color = "#4fa8e0" if close >= o else "#6e7681"
        ax.plot([t, t], [l, h], color=color, linewidth=1)
        y0, y1 = sorted([o, close])
        ax.add_patch(
            Rectangle(
                (mdates.date2num(t) - width.total_seconds() / 86400 / 2, y0),
                width.total_seconds() / 86400,
                max(y1 - y0, 0.001),
                facecolor=color,
                edgecolor=color,
            )
        )

    x0 = mdates.date2num(datetime.fromtimestamp(int(candles[0]["time"]), tz=timezone.utc))
    x1 = mdates.date2num(datetime.fromtimestamp(int(candles[-1]["time"]), tz=timezone.utc)) + width.total_seconds() / 86400

    if tp is not None:
        ax.add_patch(Rectangle((x0, min(entry, tp)), x1 - x0, abs(tp - entry), facecolor="#1f5fa8", alpha=0.55, zorder=0))
    if sl is not None:
        ax.add_patch(Rectangle((x0, min(entry, sl)), x1 - x0, abs(sl - entry), facecolor="#7a2026", alpha=0.55, zorder=0))

    ax.axhline(entry, color="#c9d1d9", linewidth=1)
    ax.text(x1, entry, f" Entrée {entry:.3f}", color="#c9d1d9", va="center", fontsize=9)
    if tp is not None:
        ax.axhline(tp, color="#4fa8e0", linewidth=1, linestyle="--")
        ax.text(x1, tp, f" TP {tp:.3f}", color="#4fa8e0", va="center", fontsize=9)
    if sl is not None:
        ax.axhline(sl, color="#d9534f", linewidth=1, linestyle="--")
        ax.text(x1, sl, f" SL {sl:.3f}", color="#d9534f", va="center", fontsize=9)

    open_x = mdates.date2num(datetime.fromtimestamp(int(trade["openTime"]), tz=timezone.utc))
    if open_x > x0:
        ax.axvline(open_x, color="#8b949e", linewidth=1, linestyle=":")

    net = trade["net"]
    sign = "+" if net >= 0 else ""
    label = REASON_LABELS.get(trade["reason"], f"clôturé ({trade['reason']})")
    ax.set_title(
        f"{trade['symbol']} — {trade['type']} — ticket {trade['positionId']} — {label} {sign}{net:.2f}$",
        color="#c9d1d9",
        fontsize=11,
        loc="left",
    )
    ax.set_xlim(x0, x1 + (x1 - x0) * 0.12)
    ax.tick_params(colors="#8b949e")
    for spine in ax.spines.values():
        spine.set_color("#30363d")
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%d/%m %Hh"))
    fig.autofmt_xdate()
    plt.tight_layout()

    buf = BytesIO()
    plt.savefig(buf, format="png", dpi=150, facecolor=fig.get_facecolor())
    plt.close(fig)
    return buf.getvalue()


def _upload(mistake_id, png_bytes):
    if not CRON_SECRET:
        print("[CHART] échec upload : CRON_SECRET absent")
        return None
    if len(png_bytes) > MAX_IMAGE_BYTES:
        print("[CHART] échec upload : image trop lourde")
        return None

    payload = json.dumps(
        {
            "mistakeId": mistake_id,
            "contentType": "image/png",
            "dataBase64": base64.b64encode(png_bytes).decode("ascii"),
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        f"{BACKEND_URL}/api/trade-chart/upload",
        data=payload,
        headers={"Authorization": f"Bearer {CRON_SECRET}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"[CHART] échec upload : {e}")
        return None


def generate_and_attach(db, m, trade, mistake_id):
    """Génère le graphique de ce trade et l'attache à l'entrée de journal
    `mistake_id`. Retourne True si l'image a bien été attachée, False sinon
    (jamais d'exception laissée remonter — l'appelant doit pouvoir continuer
    dans tous les cas)."""
    ticket = trade["positionId"]

    sl, tp, entry_comment = _original_order_details(m, ticket)
    if sl is None and tp is None:
        print(f"[CHART] position {ticket} : SL/TP introuvables dans l'historique MT5, graphique ignoré")
        return False

    timeframe = resolve_timeframe(db, ticket, entry_comment) or DEFAULT_TIMEFRAME

    start_ts = _chart_window(trade["openTime"], trade["closeTime"], timeframe)
    candles = _fetch_candles(m, trade["symbol"], timeframe, start_ts, trade["closeTime"])
    if len(candles) == 0:
        print(f"[CHART] position {ticket} : aucune bougie récupérée, graphique ignoré")
        return False

    png_bytes = _render_png(trade, candles, timeframe, trade["priceOpen"], sl, tp)
    result = _upload(mistake_id, png_bytes)
    if result is None:
        return False

    print(f"[CHART] position {ticket} : graphique généré et attaché à l'entrée {mistake_id}")
    return True
