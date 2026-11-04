// Beulah Park Water — Chlorine home-screen widget (iOS / Scriptable)
//
// SETUP (one time, ~2 min):
//   1. Install "Scriptable" from the App Store (free).
//   2. Open Scriptable → tap + → paste this whole file → name it "Chlorine".
//   3. Long-press your home screen → + → Scriptable → add a Medium widget.
//   4. Long-press the new widget → Edit Widget → Script: choose "Chlorine".
//
// It refreshes itself roughly every 15–30 min (iOS decides exactly when).
// Tap the widget to open the full dashboard.

// --- CONFIG ---------------------------------------------------------------
// Confirm this URL loads in a browser; swap in your custom domain if you use one.
const DATA_URL = "https://water-system-dashboard.fly.dev/api/chlorine/latest"
const DASHBOARD_URL = "https://water-system-dashboard.fly.dev/"
// --------------------------------------------------------------------------

// Status → color, label, and SF Symbol (matches the dashboard thresholds)
const STATUS = {
  good:    { color: "#16a34a", label: "Good",    symbol: "checkmark.circle.fill" },
  low:     { color: "#d97706", label: "Low",     symbol: "exclamationmark.triangle.fill" },
  warning: { color: "#dc2626", label: "Warning", symbol: "exclamationmark.octagon.fill" },
}

const CARD_BG   = new Color("#f3efe9") // cream card
const INK       = new Color("#1c1c1c")
const MUTED     = new Color("#6b6b6b")

let widget
try {
  const latest = await new Request(DATA_URL).loadJSON()
  if (latest?.ppm == null) throw new Error(latest?.error || "No chlorine reading in feed")
  widget = buildWidget(latest)
} catch (e) {
  widget = buildError(e)
}

widget.url = DASHBOARD_URL
if (config.runsInWidget) {
  Script.setWidget(widget)
} else {
  await widget.presentMedium()
}
Script.complete()

function buildWidget(latest) {
  const meta = STATUS[latest.status] || STATUS.warning
  const accent = new Color(meta.color)

  const w = new ListWidget()
  w.backgroundColor = CARD_BG
  w.setPadding(18, 20, 18, 20)

  // Header
  const title = w.addText("Chlorine Levels")
  title.font = Font.semiboldSystemFont(17)
  title.textColor = INK

  const sub = w.addText("Free Chlorine Monitoring")
  sub.font = Font.systemFont(12)
  sub.textColor = MUTED

  w.addSpacer(10)

  // Main row: big number on the left, status badge on the right
  const row = w.addStack()
  row.centerAlignContent()

  const left = row.addStack()
  left.layoutVertically()

  const valueRow = left.addStack()
  valueRow.bottomAlignContent()
  const value = valueRow.addText(formatPpm(latest.ppm))
  value.font = Font.boldSystemFont(46)
  value.textColor = INK
  valueRow.addSpacer(5)
  const unit = valueRow.addText("ppm")
  unit.font = Font.semiboldSystemFont(16)
  unit.textColor = MUTED

  left.addSpacer(4)
  const tested = left.addText("Last tested: " + formatDate(latest.timestamp))
  tested.font = Font.systemFont(11)
  tested.textColor = MUTED

  row.addSpacer()

  const badge = row.addStack()
  badge.layoutVertically()
  badge.centerAlignContent()
  const icon = badge.addImage(SFSymbol.named(meta.symbol).image)
  icon.imageSize = new Size(40, 40)
  icon.tintColor = accent
  badge.addSpacer(6)
  const statusText = badge.addText(meta.label)
  statusText.font = Font.semiboldSystemFont(14)
  statusText.textColor = INK
  statusText.centerAlignText()

  return w
}

function buildError(err) {
  const w = new ListWidget()
  w.backgroundColor = CARD_BG
  w.setPadding(18, 20, 18, 20)
  const t = w.addText("Chlorine")
  t.font = Font.semiboldSystemFont(16)
  t.textColor = INK
  w.addSpacer(6)
  const m = w.addText("Couldn't load reading")
  m.font = Font.systemFont(13)
  m.textColor = MUTED
  w.addSpacer(2)
  const d = w.addText(String(err.message || err))
  d.font = Font.systemFont(10)
  d.textColor = MUTED
  return w
}

function formatPpm(ppm) {
  const n = Number(ppm)
  return Number.isFinite(n) ? n.toFixed(2) : "—"
}

function formatDate(iso) {
  const d = new Date(iso)
  if (isNaN(d)) return "unknown"
  const f = new DateFormatter()
  f.dateFormat = "MMM d, yyyy, h:mm a"
  return f.string(d)
}
