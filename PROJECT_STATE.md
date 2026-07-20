# PROJECT STATE — NIFTY Smart Money Tracker

> Hand this file (plus the latest zip) to Claude at the start of any new chat to resume
> with full context. The **code in the zip is the source of truth**; this file is the map.

Last updated at: **v75** (signal logger). Current build stamp in `src/App.jsx` footer:
`BUILD v75 · TRACK A · SIGNAL LOGGER`.

---

## 1. What this app is

A personal (single-user) option-chain analysis web app for an Indian retail trader, focused
on NIFTY but works for any NSE stock/index. It reads live option-chain data, scores
directional bias, computes gamma exposure, runs an ICT (Smart Money Concepts) price-structure
engine, and recommends option trades with expected-value framing. **Decision-support only —
not auto-trading, not investment advice.** It deliberately talks the user OUT of bad trades
(negative-EV flags, divergence warnings, "context not a trigger").

Owner/user: Windows; trades NIFTY; direct step-by-step communicator; wants honest flagging of
limitations over overpromising; likes "design first → approve → implement" for UI; prefers
plain language over jargon.

---

## 2. Tech stack & structure

- Vite + React 18 + Tailwind 3 + Recharts + lucide-react + jose + nodemailer + @vercel/kv
- Single main file: `src/App.jsx` (~4,160 lines). Backend: `api/*.js` serverless functions.
- Build: `npm install && npm run build`. **node_modules is stripped when zipping → ALWAYS
  `npm install` before building, or you get "vite: not found".**
- Auth: email OTP, JWT cookies (stateless, no DB). Admin gating via `ALLOWED_EMAILS` /
  `ADMIN_EMAIL` env vars.

### Deployment
- **Vercel**, project `option-chain-tracker`, region bom1, **Hobby plan**.
- Live URL: `option-chain-tracker.vercel.app`.
- Now **GitHub-connected**: repo `github.com/nitrathod/smart-money-ui`, branch `main`.
  Every `git push` auto-deploys. (Was previously manual `npx vercel --prod` from a zip.)
- **Vercel KV is sunset** → uses **Upstash Redis** under the hood. Credentials already set
  as env vars `KV_REST_API_URL` + `KV_REST_API_TOKEN` (the `@vercel/kv` package reads these).

### CRITICAL constraint — Vercel function limit
Hobby plan = **MAX 12 serverless functions**. Every `.js` under `api/` counts EXCEPT
`api/_lib/` (underscore-prefixed). **Currently 10 functions** (2 free):
`api/auth/{logout,me,request-access,request,users,verify}.js` (6),
`api/dhan-chain.js`, `api/nse-chain.js`, `api/dhan-candles.js`, `api/signals.js`.
Helpers (not counted): `api/_lib/{auth,symbols}.js`.
> User-deploy trap: extracting a new zip OVER an old folder leaves deleted files behind →
> stale functions exceed 12. Fix: delete old folder first, extract fresh. (Less relevant now
> that GitHub deploys, but keep in mind.)

### Env vars (set in Vercel, never in repo)
`JWT_SECRET`, `ADMIN_EMAIL`, `ALLOWED_EMAILS`, `SMTP_HOST/PORT/USER/PASS/FROM`,
`KV_REST_API_URL`, `KV_REST_API_TOKEN`. Dhan token is NOT an env var — user pastes it in the
app each day (expires daily).

---

## 3. What's BUILT (done & working)

### Options engine
- Chain parsing (paste + live Dhan/NSE), two-pass strike detection, stock + index aware.
- `analyzeChain()` → PCR, max pain, expected range, net ΔOI, call/put walls, build-up/unwind.
- `generateVerdict()` → −3…+3 score + label + reasons + price-vs-positioning divergence flag.
- `generateTradeIdea()` → recommended strike/type, entry/target/SL, EV (probability-weighted),
  R:R, IV, DTE, spot entry-trigger ("enter only if spot breaks X on a 5m close"), trailing
  stop, 3-depth strike ladder (ATM/2-ITM/3-ITM). All distances parameterized as strikeStep
  multiples (NIFTY step 50 → byte-identical to original).
- Black-Scholes greeks (`blackScholes`), EV uses P(touch) ≈ 2×P(close beyond) from ATM IV.

### Gamma exposure
- Tier 1: per-strike gamma×OI → `peakGammaStrike` (pin), concentration, pin distance.
- Tier 2: signed GEX → `gammaFlip` (regime boundary), `gammaRegime` ('long'=mean-revert/chop,
  'short'=trend/amplify). `gexInverted` module const + live INVERT toggle (display-only).
- NOTE: sign assumed standard; GEX magnitude treated as relative (NSE OI units ambiguous).
  Right on the flip the read is meaningless ("fragile"). Needs live calibration.

### Symbol support
- `api/_lib/symbols.js`: dynamic Dhan instrument CSV → {scrip, seg, lotSize, label, type},
  12h cache, static fallback (NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY/RELIANCE).
- Searchable `SymbolPicker`. `DYNAMIC_LOTS` populated on mount. `getLotSize()`.
- NIFTY lot = **65** (NSE cut 75→65 after 30-Dec-2025). BANKNIFTY likely 30 (we have 35) —
  unverified; dynamic master auto-corrects when its fetch succeeds.

### ICT (Smart Money Concepts) engine — COMPLETE
All pure functions in App.jsx (harness-extractable):
- Candle pipeline: `api/dhan-candles.js` (Dhan intraday, native 1/5/15/25/60 min).
- Primitives: `detectSwings`, `liquidityPools` (BSL/SSL), `equalLevels` (EQH/EQL),
  `detectSweeps` (wick-through + close-back = sweep vs breakout), `detectMSS` (structure break),
  `detectOrderBlocks` (OB), `detectFVGs` (fair value gaps).
- Assembly: `premiumDiscount` (50% dealing range), `structureBias` (HH/HL→bull),
  `qualifyMSS` (sweep→same-dir break within 6 bars = true shift),
  `ictTopDown({h1,m15,m5,m1})` → {bias, zone, ob, trigger, status:'ready'|'forming'|'none', notes}.
- `gammaConfluence(ict, gamma, spot)` → 'strong'|'supportive'|'mixed'|'conflicting'|'n/a'.
- `scopeCandles(candles, interval)` — caps lookback per TF (1:120, 5:96, 15:64, 60:42 bars).
- `markMitigated` / `freshZones` — drop OB/FVG price already traded back through.
- `ICTChart` — custom SVG candlestick (Recharts has no candlesticks): candles + BSL/SSL +
  fresh OB/FVG zones + sweep markers + last MSS + premium/discount EQ midline.
- UI: admin + Dhan-only "ICT candle spike" strip (1m/5m/15m/1H test), "Top-down ▸" button,
  "ICT chart" 5m/15m/1H buttons. Plain-English wording (v74): "down (look to sell) / NOT READY
  YET", "Price is in the upper/lower half / middle of its range", "Entry signal: not yet
  (waiting for a 5M stop-hunt + break)", "Sell zone to watch: X–Y", "Options agreement:
  conflicting (they disagree)".

### Validation logger — Track A step 1 (v75)
- `buildSignalRecord({analysis, idea, symbol, spot, openSpot, expiry, ict})` (pure) → compact
  record: verdict/score/divergence, pcr/maxPain/atm, gamma pin/flip/regime, reco
  strike/type/entry/target/SL/entryTrigger, EV/probs/IV/RR, ICT bias/status/confluence, and
  empty outcome fields (outcome, outcomeAt, mfePts, maePts) for the scorer.
- `api/signals.js`: `?op=log` (POST), `?op=list`, `?op=stats`. Backed by KV/Upstash. Keys
  `sig:<symbol>:<ts>`, indexed in sorted set `sigidx:<symbol>` + `sigidx:ALL` by timestamp.
  Auth-gated; 503 with clear message if KV not configured.
- Client: fires fire-and-forget on every Analyze (in `handleAnalyze`). Admin-only status line
  under Analyze button: "signal log: ✓ saved HH:MM:SS".

---

## 4. ROADMAP — what's LEFT (priority order)

### Track 0 — housekeeping (cheap)
- Verify BANKNIFTY lot (likely 30 not 35); FINNIFTY/MIDCPNIFTY.
- Gamma sign calibration vs live expiry-week sessions (observation, no code).

### Track A — VALIDATION (the priority; decides if the app has edge). Sequential:
- A1. **Signal logger — DONE (v75).**
- A2. **Outcome scorer (NEXT).** A job that reads logged signals, pulls candles (and ideally
  option-premium paths), and marks each `outcome` = target/sl/timeout, plus MFE/MAE. Likely a
  new function or an op on `api/signals.js` (mind the 12-function limit → prefer adding an
  `?op=score` to signals.js over a new file).
- A3. **Edge dashboard.** Admin screen: hit-rate, expectancy, EV calibration (predicted vs
  realized), sliced by regime / confluence / DTE / time-of-day. Reads `?op=list`, computes
  client-side.
- A4. **Mechanical gate + sizing.** ONLY after months of A3 data prove edge. The validated
  boolean entry rule (verdict + EV>0 + ICT ready + confluence ok + spot trigger) + position
  sizing + walk-forward discipline.

### Track B — stock-options quality (independent)
- B1. Phase 3 — liquidity guardrails: min-OI/volume filter, surface bid-ask spread, "thin
  chain — low confidence" flag, dividend note. Also hardens gamma tiers.
- B2. Phase 4 — per-symbol snapshot keying (multi-symbol without clobbering) + basket test.

### Track C — quant refinements
- C1. Costs into EV (brokerage/STT/slippage).
- C2. Dynamic IV / IV-crush modelling (matters most on 1-DTE).
- C3. Intraday OI trajectory (time-series, not single snapshot).
- C4. Lot-size verification (see Track 0).
- C5. Scorecard meta-flaw (linear weighted sum of correlated signals) — best resolved by
  Track A data, not by re-theorizing weights.

---

## 5. Known limitations (be honest with the user about these)

- **No backtest / no validated edge.** Everything is coherent, not proven. A clean 5-year
  backtest isn't realistically sourceable (needs historical option-chain snapshots, not just
  candles). Forward-logging (Track A) is the realistic path. Expected edge unknown; prior is
  break-even-to-slightly-positive on direction, likely net-negative after costs if traded
  mechanically on near-expiry option buying. Real value = discipline/filter, not signal alpha.
- Verdict is a linear weighted sum of correlated signals (heuristic, not a measurement).
- OI direction is ambiguous (can't tell writers from buyers from OI+price alone).
- Gamma sign/magnitude uncalibrated; meaningless on the flip.
- EV model assumes lognormal/constant-vol; magnitude is noisy.
- Costs/slippage not in EV. ICT is one hard-coded interpretation of a discretionary framework.
- It is NOT Bloomberg — single broker's data, no execution, no news, no multi-asset.

---

## 6. Build / test workflow (for Claude in a new chat)

- Restore: `unzip <latest>.zip -d /home/claude`, then `cd option-chain-tracker`.
- ALWAYS `npm install` before `npm run build` (node_modules stripped on zip).
- Pure functions live module-level in App.jsx so a Node harness can extract + test them. The
  harness (`/tmp/regen.cjs` etc.) is recreated per session if needed; core regression intent:
  NIFTY behavior must stay byte-identical (express NIFTY-isms as strikeStep multiples).
- **str_replace gotcha (hit ~5×):** replacing a function's opening/signature line silently
  deletes that function. ALWAYS re-include the anchor (the `function foo(...) {` line) in
  new_str when inserting after it. The build catches it (Unexpected token), but check.
- Harness extractor pulls FUNCTIONS only, not module-level `const` → inline any lookup tables
  inside the function (see how ICT_LOOKBACK was inlined into scopeCandles).
- After changes: bump the footer BUILD stamp, `npm install && npm run build`, verify function
  count ≤ 12, repackage zip to `/mnt/user-data/outputs/option-chain-tracker-vNN.zip`.

## 7. Versioning
Latest = **v82**. Bump the footer string in `src/App.jsx` each version. Recent: v78 ICT actionable plan,
v79 ICT day-trade ladder, v80 OI recorder, v81 bias momentum fallback, **v82 live signal engine**.

> **v82 change:** live setup engine with a Balanced/Strict toggle (user chose toggle). NEW pure helper
> `evalSignal(ict, mode)` → {state, side, entry, sweepName, optionsAgree, optionsFight}. The 3-gate
> structural core = `ictResult.status === 'ready'` (bias + 15M key sweep + 5M entry). Balanced fires on
> the core regardless of options; Strict additionally requires `confluence.level` ∈ {strong, supportive}
> (else holds as 'armed_waiting_options'). Options read = existing `gammaConfluence` (kept advisory, not
> a blocker, in Balanced — because gamma/PCR are uncalibrated+correlated). Wiring: `signalMode` state
> (persisted 'signal-mode', default balanced); `runTopDown(quiet)` now also auto-runs on the 60s
> auto-fetch loop (guarded by `ictRunningRef` against overlap; quiet = no spinner); `signal` useMemo;
> fired-alert useEffect raises a browser Notification + a dismissible on-screen banner, keyed by
> side@entry@date via `firedKeyRef` so it alerts once per fresh signal. UI: mode toggle next to
> Top-down; persistent SIGNAL banner (Radio icon, side-coloured, entry level, options state, mode,
> time); panel status line now mode-aware ("🔔 FIRED — SELL" / "waiting for options to agree (strict)").
> Validated evalSignal across mode×options matrix. Admin-gated (operator). Still unvalidated edge —
> Track A logging is the measurement path; toggle lets the user A/B the two modes against outcomes.
> Auto-eval adds ~4 candle fetches/min during market hours (watch Dhan quota; throttle if needed).

> **v81 change (bug fix):** ICT panel showed "no clear trend" almost every day. Root cause (NOT a v79
> regression — long-standing): 1H `bias` came purely from `structureBias`, which returns 'neutral' on
> (a) strong trend days — a clean one-directional move forms NO swing pivots, so detectSwings yields
> <2 highs/lows → neutral; and (b) choppy days — mixed last-two swings → neutral. So it only gave a
> direction in a narrow stair-step case. Fix: added `trendBias(candles, threshold=0.33)` momentum
> fallback (net move across the 1H window as a fraction of its range). In `ictTopDown`, when
> `structureBias` is neutral, fall back to `trendBias(h1.candles)` then `trendBias(m15.candles)`;
> tracks `biasSource` ('structure' | 'momentum') and the note reads "trending down (by momentum)"
> when the fallback fired. Verified: clean down/up trends now register bearish/bullish; genuine chop
> stays neutral. This makes the day-trade ladder actually arm on trend days like a 174-pt move.

> **v80 change:** backend for the Sensibull-style OI time-scrubber. NEW `api/oi.js` (one function,
> 3 ops, → 11/12 total): `?op=record&key=SECRET` (GET, secret-gated via `RECORDER_SECRET` env — for
> an EXTERNAL scheduler, NOT session-gated; checks IST market hours 9:15–15:30 Mon–Fri; reads creds
> from Redis `dhan-creds`; self-fetches `/api/dhan-chain` with stored creds; stores compact snapshot
> `{t,s,d:[[strike,ceOi,peOi]]}` to list `oi:<SYM>:<istDate>` with 3-day expiry); `?op=history`
> (GET, requireAuth — the day's snapshots for the scrubber); `?op=token` (POST, requireAuth — saves
> `dhan-creds`={clientId,accessToken,symbols} TTL 16h). Client: settings `save()` now fire-and-forget
> POSTs creds to `/api/oi?op=token`. **Decision: Path 1 = free external scheduler** (cron-job.org)
> hits the record route every minute — because per-minute Vercel cron requires Pro (verified). NO
> vercel.json cron block (would fail Hobby deploy). **History accrues only from switch-on (no backfill).**
>
> **Setup owed by user:** (1) Vercel env var `RECORDER_SECRET`=<random>; (2) cron-job.org free account
> → GET `https://option-chain-tracker.vercel.app/api/oi?op=record&key=<SECRET>` every 1 min (route
> self-skips outside market hours); (3) re-enter Dhan token in-app each day (now also persists to Redis).
>
> **Next phase:** OI SCRUBBER UI — slider 9:15→now + Last 5/10/15/30m,1/2/3hr,Full Day buttons feeding
> FootprintChart with historical OI at the chosen time. Build AFTER a trading day of data accrues.

> **v79 change:** retuned the ICT ladder to a day-trade model (user's intent: clean intraday
> setups, ~daily). New ladder: **1H = bias only; 15M = PRIMARY sweep of real liquidity; 5M =
> inducement + entry; 15M OB = entry zone.** Two new pure helpers: `sessionLevels(candles)` →
> PDH/PDL + opening-range (first 60 min) high/low, computed from RAW multi-day 5M candles (IST
> day bucketing via `Math.floor((t+19800)/86400)`); `detectKeyLevelSweeps(candles, levels)` →
> first wick-through-and-close-back of each named level (breakout ≠ sweep). `ictTopDown` rewritten:
> finds the relevant key levels for the bias (bearish→PDH/ORH buy-side, bullish→PDL/ORL sell-side),
> detects a TODAY-only 15M sweep of them (keySweep), then requires a qualified 5M sweep+MSS aligned
> with bias AFTER the keySweep (triggerFired). Status values changed: `ready` (TRIGGER FIRED) /
> `armed` (SETUP ARMED — key level swept, awaiting 5M entry) / `watching` (WATCHING — awaiting 15M
> sweep) / `none`. `triggerPlan` now carries `sweepName` (e.g. "PDH") + `sweepLevel` + `breakLevel`.
> Panel updated with the three states + key-level-anchored plan text. Old fields removed:
> `trigger`/`triggerAligned` (gammaConfluence only uses `bias`, unaffected). Still unvalidated —
> Track A logging remains the way to know if the 15M model beats the old generic-5M one.

> **v78 change:** addressed "always NOT READY YET / no signal." Diagnosis: the `triggerAligned`
> gate (a qualified 5M sweep+MSS aligned with 1H bias, within the scoped ~96-bar window) is
> legitimately rare, so READY almost never fires — by design, and loosening it would manufacture
> false signals on an unvalidated engine. Fix: made the everyday "forming" state actionable.
> `ictTopDown` now returns `triggerPlan` = {dir, side, sweepLevel, breakLevel} computed from m5
> swings (bearish: nearest swing high ≥ price = sweep level, nearest swing low < price = break
> level; bullish mirrors). The panel reframes status words (ready→"TRIGGER FIRED",
> forming→"PLAN SET — awaiting trigger", none→"no clear setup yet") and renders a concrete plan
> line: "Sell rallies into [OB]; set an alert: enter on a 5M close below [breakLevel] after a poke
> above [sweepLevel]." So the user gets a set-an-alert plan every time, instead of a dead end.
> READY remains rare/honest. Still unvalidated — Track A logging is the path to knowing if it works.

> **v77 change:** rebuilt `FootprintChart`'s chart body as a **custom SVG** (Sensibull-style),
> replacing Recharts. Per strike: green put bar + red call bar side by side. Coloured height =
> current OI; striped cap = OI added today; hollow dashed cap = OI removed today (ghost above);
> dashed vertical spot line; hover tooltip (Strike · Put OI+chg · Call OI+chg). The "Show total
> OI" toggle now switches between full-OI view (on) and today's-change-only view (off). Kept the
> existing strike-range controls + footer totals; updated the legend + how-to-read text. Encoding
> from `oi`/`chngOi`: prior = oi−chngOi. **Recharts fully removed** (import deleted) → bundle
> ~590KB→248KB. Colors: emerald #10b981 puts, red #ef4444 calls.

> **v76 change:** the user removed three DISPLAY blocks from `AnalysisView` (found them
> misleading/noisy): the Unified Decision Card (verdict label/score + recommended trade
> summary + EV warning + divergence + reasons bullets), the entire `TradeIdeaCard` (positioning
> read "NO CLEAR BIAS" header + admin trade recommendation + ATM/2-ITM/3-ITM depth cards +
> same-day levels + spot entry trigger + EV breakdown), and the Strike-focus picker. The
> underlying COMPUTATION is untouched (`analyzeChain`/`generateVerdict`/`generateTradeIdea`
> still run), so the signal logger keeps recording the full record. `TradeIdeaCard` is now a
> defined-but-unused component; `selectedDepthIdx` and `focusStrike` are now effectively dead
> state (harmless). AnalysisView now shows: metric cards → gamma strip → combined Footprint
> chart. ICT panels (in MainApp) unchanged. To restore any of it, pull the blocks from the
> v75 zip.
