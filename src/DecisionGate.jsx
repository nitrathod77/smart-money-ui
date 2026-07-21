import React, { useState, useMemo, useEffect } from 'react';
import {
  ShieldCheck, Lock, Check, X, AlertTriangle, Clock, TrendingUp, TrendingDown,
  Minus, Activity, Layers, Flame, Ban, PauseCircle, ArrowRight, ClipboardCopy,
  ChevronDown, ChevronRight,
} from 'lucide-react';

// ============================================================================
// DECISION GATE — Price Action Playbook (Manual Volume III · Modules 19–22)
// ----------------------------------------------------------------------------
// The Smart Money engine tells you WHAT institutions did in the chain.
// This module answers the only question that spends money: should *I* click buy
// on THIS trade, right now? Every candidate runs three gates in sequence. If any
// gate fails, you stop. The tree is biased toward NOT trading — on purpose.
//
//   Structure tells you WHERE to act. Candles tell you WHEN to pull the trigger.
// ============================================================================

// ---- small helpers ---------------------------------------------------------
const nowIST = () => {
  // Convert local time to IST (UTC+5:30) regardless of machine timezone.
  const utc = Date.now() + new Date().getTimezoneOffset() * 60000;
  return new Date(utc + 5.5 * 3600000);
};

// Prime trading windows from the manual: 9:45–11:30 AM (best) and 1:30–2:30 PM.
function timeWindowStatus() {
  const t = nowIST();
  const mins = t.getHours() * 60 + t.getMinutes();
  const inMorning = mins >= 9 * 60 + 45 && mins <= 11 * 60 + 30;
  const inAfternoon = mins >= 13 * 60 + 30 && mins <= 14 * 60 + 30;
  const label = t.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  let note = 'Outside the prime windows — wait';
  if (inMorning) note = 'Morning trend window (9:45–11:30)';
  else if (inAfternoon) note = 'Afternoon window (1:30–2:30)';
  else if (mins > 14 * 60 + 30) note = 'After 2:30 PM — theta acceleration, do not initiate';
  else if (mins >= 12 * 60 && mins < 13 * 60 + 30) note = 'Lunch chop (12:00–1:30) — avoid';
  else if (mins < 9 * 60 + 45) note = 'First 15–30 min — watch only';
  return { pass: inMorning || inAfternoon, label, note };
}

const clsPass = 'text-emerald-700 bg-emerald-50 border-emerald-300';
const clsFail = 'text-red-700 bg-red-50 border-red-300';
const clsIdle = 'text-slate-500 bg-white border-slate-200';

// A single toggleable checklist row.
function Check3({ state, onCycle, label, detail, pass, locked }) {
  // state: 'auto' handled by parent via `pass`; here we render a manual tri-state
  const cls = locked ? clsIdle : (state === 'yes' ? clsPass : state === 'no' ? clsFail : clsIdle);
  return (
    <button
      type="button"
      disabled={locked}
      onClick={onCycle}
      className={`w-full text-left flex items-start gap-3 rounded-lg border px-3 py-2.5 transition ${cls} ${locked ? 'opacity-50 cursor-not-allowed' : 'hover:border-slate-400'}`}
    >
      <span className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-md border flex items-center justify-center ${
        state === 'yes' ? 'bg-emerald-600 border-emerald-600 text-white'
        : state === 'no' ? 'bg-red-600 border-red-600 text-white'
        : 'bg-white border-slate-300 text-transparent'}`}>
        {state === 'yes' ? <Check className="w-3.5 h-3.5" /> : state === 'no' ? <X className="w-3.5 h-3.5" /> : null}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium leading-tight">{label}</span>
        <span className="block text-[11px] font-mono text-slate-500 mt-0.5">{pass || detail}</span>
      </span>
    </button>
  );
}

function GateShell({ index, title, subtitle, locked, passed, children }) {
  return (
    <div className={`rounded-xl border card-shadow bg-white transition ${locked ? 'opacity-60' : ''} ${passed ? 'border-emerald-300' : 'border-slate-200'}`}>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
          passed ? 'bg-emerald-600 text-white' : locked ? 'bg-slate-100 text-slate-400' : 'bg-amber-500 text-white'}`}>
          {locked ? <Lock className="w-4 h-4" /> : passed ? <Check className="w-4 h-4" /> : <span className="text-sm font-bold">{index}</span>}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold tracking-wide uppercase text-slate-800">{title}</div>
          <div className="text-[11px] font-mono text-slate-500">{subtitle}</div>
        </div>
        {passed && <span className="ml-auto text-[10px] font-mono uppercase tracking-widest text-emerald-600">passed</span>}
        {locked && <span className="ml-auto text-[10px] font-mono uppercase tracking-widest text-slate-400">locked</span>}
      </div>
      <div className="p-4 space-y-2.5">{children}</div>
    </div>
  );
}

function Accordion({ title, icon, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-slate-200 bg-white card-shadow">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-4 py-3 text-left">
        {icon}
        <span className="text-sm font-semibold tracking-wide uppercase text-slate-700">{title}</span>
        {open ? <ChevronDown className="w-4 h-4 ml-auto text-slate-400" /> : <ChevronRight className="w-4 h-4 ml-auto text-slate-400" />}
      </button>
      {open && <div className="px-4 pb-4 text-sm text-slate-600 space-y-3">{children}</div>}
    </div>
  );
}

// ============================================================================
export default function DecisionGate({ analysis, spot, symbol, vix, vixPrev, gift, giftPrev, isExpiryDay, dateKey, storage, idea }) {
  const timeWin = timeWindowStatus();

  // ---- live trade-idea suggestions (from the app's own engine) ------------
  const sug = useMemo(() => {
    if (!idea) return null;
    const dir = idea.action === 'BUY_CE' ? 'up' : idea.action === 'BUY_PE' ? 'down' : null;
    return {
      bias: dir,
      delta: idea.entryDelta != null ? Math.abs(idea.entryDelta) : null,
      entry: spot != null ? Math.round(spot) : null,
      stop: idea.stopLoss != null ? Math.round(idea.stopLoss) : null,
      target: idea.target != null ? Math.round(idea.target) : null,
      rr: idea.riskReward || null,
      strike: idea.strike ?? null,
      premium: idea.entryPremium ?? null,
    };
  }, [idea, spot]);

  // ---- derive live confluence from the option chain -----------------------
  const chain = useMemo(() => {
    if (!analysis || spot == null) return null;
    const callWalls = analysis.callWalls || [];
    const putWalls = analysis.putWalls || [];
    // Nearest call wall ABOVE spot = resistance ceiling. Nearest put wall BELOW = support floor.
    const resWall = callWalls.filter(r => r.strike >= spot).sort((a, b) => a.strike - b.strike)[0]
      || callWalls.sort((a, b) => b.ce.oi - a.ce.oi)[0];
    const supWall = putWalls.filter(r => r.strike <= spot).sort((a, b) => b.strike - a.strike)[0]
      || putWalls.sort((a, b) => b.pe.oi - a.pe.oi)[0];
    return {
      resistance: resWall ? resWall.strike : null,
      support: supWall ? supWall.strike : null,
      maxPain: analysis.maxPain,
      pcr: analysis.pcr,
      verdict: analysis.verdict,
    };
  }, [analysis, spot]);

  // Engine hint for bias (from the positioning verdict) — a *hint*, not the decision.
  const engineBias = chain?.verdict
    ? (chain.verdict.score >= 1 ? 'up' : chain.verdict.score <= -1 ? 'down' : 'range')
    : null;

  // VIX / IVP environment
  const vixSpike = vix != null && vixPrev != null && vix > vixPrev * 1.15;
  const vixHigh = vix != null && vix >= 20;
  const giftDrift = (gift != null && giftPrev != null && giftPrev > 0) ? ((gift - giftPrev) / giftPrev) * 100 : null;
  const riskOff = giftDrift != null && giftDrift < -0.6;

  // ---- GATE 1: Environment -------------------------------------------------
  const [ivp, setIvp] = useState('');
  const ivpNum = ivp === '' ? null : parseFloat(ivp);
  const [g1, setG1] = useState({ events: 'idle', global: 'idle' });
  // auto-derived gate-1 states
  const g1_ivp = ivpNum == null ? 'idle' : (ivpNum < 75 ? 'yes' : 'no');
  const g1_vix = vix == null ? 'idle' : (vixSpike || vixHigh ? 'no' : 'yes');
  const g1_events = isExpiryDay ? 'no' : g1.events;
  const g1_time = timeWin.pass ? 'yes' : 'no';
  const g1_global = riskOff ? 'no' : g1.global;
  const gate1 = [g1_ivp, g1_vix, g1_events, g1_time, g1_global];
  const gate1Pass = gate1.every(s => s === 'yes');

  // ---- GATE 2: Setup -------------------------------------------------------
  const [bias, setBias] = useState(null); // 'up' | 'down' | 'range'
  const [level, setLevel] = useState({ factors: {}, atLevel: 'idle' });
  const [candle, setCandle] = useState(null); // { type, dir }
  const [bos, setBos] = useState('idle');

  const factorKeys = [
    ['reactions', '≥2 clean reactions (3+ = watched)'],
    ['strength', 'Reactions were strong, not limp drifts'],
    ['recency', 'Respected recently (this week)'],
    ['timeframe', 'Visible on 15m / 1h, not just 1m'],
    ['confluence', 'Confluence — incl. an OI wall lining up'],
  ];
  const factorCount = Object.values(level.factors).filter(Boolean).length;

  const g2_bias = bias === 'up' || bias === 'down' ? 'yes' : bias === 'range' ? 'no' : 'idle';
  const g2_level = factorCount >= 2 && level.atLevel === 'yes' ? 'yes'
    : (level.atLevel === 'no' || (level.atLevel === 'yes' && factorCount < 2 && factorCount > 0)) ? 'no' : 'idle';
  // Candle must exist AND agree with the bias direction (golden rule: only at a level that matters).
  const candleAgrees = candle && ((bias === 'up' && candle.dir === 'bull') || (bias === 'down' && candle.dir === 'bear'));
  const g2_candle = !candle ? 'idle' : candleAgrees ? 'yes' : 'no';
  const g2_bos = bos;
  const gate2 = [g2_bias, g2_level, g2_candle, g2_bos];
  const gate2Pass = gate1Pass && gate2.every(s => s === 'yes');

  // ---- GATE 3: Execution ---------------------------------------------------
  const [rr, setRr] = useState({ entry: '', stop: '', target: '' });
  const rrVal = (() => {
    const e = parseFloat(rr.entry), s = parseFloat(rr.stop), t = parseFloat(rr.target);
    if ([e, s, t].some(x => isNaN(x)) || e === s) return null;
    return Math.abs(t - e) / Math.abs(e - s);
  })();
  const [delta, setDelta] = useState('');
  const deltaNum = delta === '' ? null : Math.abs(parseFloat(delta));
  const [emo, setEmo] = useState({ fear: 5, greed: 5, fomo: 3, urgency: 3, calm: 7 });
  const [mentor, setMentor] = useState('idle');

  const g3_rr = rrVal == null ? 'idle' : (rrVal >= 2 ? 'yes' : 'no');
  const g3_strike = deltaNum == null ? 'idle' : (deltaNum >= 0.55 && deltaNum <= 0.75 ? 'yes' : 'no');
  const g3_emo = (emo.fomo <= 4 && emo.urgency <= 4 && emo.calm >= 6) ? 'yes' : 'no';
  const g3_mentor = mentor;
  const gate3 = [g3_rr, g3_strike, g3_emo, g3_mentor];
  const gate3Pass = gate2Pass && gate3.every(s => s === 'yes');

  // ---- VERDICT (biased toward NOT trading) --------------------------------
  const verdict = !gate1Pass
    ? { key: 'walk', label: 'Walk away', color: 'red', icon: <Ban className="w-6 h-6" />,
        note: 'Gate 1 failed — the whole day is wrong. Close the platform. This is not a setup problem; it is an environment problem.' }
    : !gate2Pass
    ? { key: 'wait', label: 'Wait', color: 'amber', icon: <PauseCircle className="w-6 h-6" />,
        note: 'Environment is clean, but no valid setup yet. Stay engaged and let price come to a level. Do not manufacture a trade.' }
    : !gate3Pass
    ? { key: 'skip', label: 'Skip this one', color: 'amber', icon: <Minus className="w-6 h-6" />,
        note: 'A setup formed but execution fails. Let this one go — the market gives another. Forcing it here is the Day-2 mistake.' }
    : { key: 'trade', label: 'Trade', color: 'emerald', icon: <ShieldCheck className="w-6 h-6" />,
        note: 'All thirteen green. Set bracket orders immediately, then walk away. First impulsive spike is often the exit.' };

  const vColor = {
    red: 'bg-red-50 border-red-300 text-red-700',
    amber: 'bg-amber-50 border-amber-300 text-amber-700',
    emerald: 'bg-emerald-50 border-emerald-300 text-emerald-700',
  }[verdict.color];

  // ---- trade thesis (only meaningful once you're at TRADE) ----------------
  const thesis = useMemo(() => {
    const dir = bias === 'up' ? 'LONG (buy CE)' : bias === 'down' ? 'SHORT (buy PE)' : '—';
    return `TRADE THESIS — ${dateKey}
SYMBOL: ${symbol}   SPOT: ${spot ?? '—'}
BIAS (15m structure): ${bias ?? '—'}  →  ${dir}
LEVEL: ${level.atLevel === 'yes' ? `at a zone (${factorCount}/5 factors)` : '—'}  | Chain confluence: R ${chain?.resistance ?? '—'} / S ${chain?.support ?? '—'} / MaxPain ${chain?.maxPain ?? '—'}
CANDLE TRIGGER: ${candle ? `${candle.type} (${candle.dir})` : '—'}
ENTRY ${rr.entry || '—'} | STOP ${rr.stop || '—'} | TARGET ${rr.target || '—'} | R:R ${rrVal ? rrVal.toFixed(2) : '—'}
STRIKE: slight-ITM, delta ${delta || '—'} (target 0.55–0.75), 1 lot
EMOTION: fear ${emo.fear} greed ${emo.greed} fomo ${emo.fomo} urgency ${emo.urgency} calm ${emo.calm}
MENTOR CHECK: ${mentor === 'yes' ? 'sent + confirmed' : 'pending'}
VERDICT: ${verdict.label}`;
  }, [bias, level, candle, rr, rrVal, delta, emo, mentor, chain, dateKey, symbol, spot, factorCount, verdict.label]);

  const [copied, setCopied] = useState(false);
  const copyThesis = async () => {
    try { await navigator.clipboard.writeText(thesis); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };

  // ---- circuit breakers (persisted per ISO-week) --------------------------
  const weekKey = (() => { const d = nowIST(); const onejan = new Date(d.getFullYear(), 0, 1); const wk = Math.ceil((((d - onejan) / 86400000) + onejan.getDay() + 1) / 7); return `cb:${d.getFullYear()}-W${wk}`; })();
  const [losses, setLosses] = useState(() => parseInt(storage?.get?.(weekKey) || '0', 10) || 0);
  useEffect(() => { storage?.set?.(weekKey, String(losses)); }, [losses, weekKey]);
  const cbState = losses >= 3 ? { c: 'red', t: '3+ losses this week → 1-week break. Done.' }
    : losses === 2 ? { c: 'red', t: '2 losses this week → 3-day break.' }
    : losses === 1 ? { c: 'amber', t: '1 loss — one more triggers the 3-day break.' }
    : { c: 'emerald', t: 'Clear. Full discipline budget available.' };
  const cbBlocked = losses >= 2;

  const cycle = (v) => v === 'idle' ? 'yes' : v === 'yes' ? 'no' : 'idle';

  // ---- save gate result to the journal ------------------------------------
  const saveToJournal = () => {
    const rec = { ts: Date.now(), date: dateKey, symbol, spot, bias, verdict: verdict.key,
      gate1: gate1Pass, gate2: gate2Pass, gate3: gate3Pass, thesis };
    storage?.set?.(`gate:${dateKey}:${Date.now()}`, JSON.stringify(rec));
    setJournalSaved(true); setTimeout(() => setJournalSaved(false), 1800);
  };
  const [journalSaved, setJournalSaved] = useState(false);

  return (
    <div className="space-y-4">
      {/* INTRO */}
      <div className="rounded-xl border border-slate-200 bg-white card-shadow p-5">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="w-5 h-5 text-amber-600" />
          <h2 className="text-base font-semibold tracking-[0.12em] uppercase text-slate-900">Decision Gate</h2>
          <span className="text-[10px] font-mono text-slate-400 ml-1">Manual Vol III · Mod 19–22</span>
        </div>
        <p className="text-sm text-slate-600 leading-relaxed">
          The engine reads the chain. This reads <span className="font-semibold text-slate-800">you</span>. Every trade clears three gates
          in order — miss one and you stop. <span className="italic">Structure tells you WHERE to act; candles tell you WHEN to pull the trigger.</span>
        </p>
      </div>

      {/* CIRCUIT BREAKER */}
      <div className={`rounded-xl border card-shadow p-4 flex items-center gap-3 ${cbState.c === 'red' ? 'bg-red-50 border-red-300' : cbState.c === 'amber' ? 'bg-amber-50 border-amber-300' : 'bg-white border-slate-200'}`}>
        <Flame className={`w-5 h-5 flex-shrink-0 ${cbState.c === 'red' ? 'text-red-600' : cbState.c === 'amber' ? 'text-amber-600' : 'text-slate-400'}`} />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-700">Circuit breaker · this week</div>
          <div className="text-[11px] font-mono text-slate-500">{cbState.t}</div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setLosses(l => Math.max(0, l - 1))} className="w-7 h-7 rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50">−</button>
          <span className="w-6 text-center text-sm font-mono font-bold text-slate-800">{losses}</span>
          <button onClick={() => setLosses(l => l + 1)} className="w-7 h-7 rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50">+</button>
        </div>
      </div>

      {/* LIVE CONTEXT (from the chain) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {[
          { l: 'Engine bias', v: engineBias === 'up' ? 'Bullish' : engineBias === 'down' ? 'Bearish' : engineBias === 'range' ? 'Range' : '—',
            ic: engineBias === 'up' ? <TrendingUp className="w-3.5 h-3.5 text-emerald-600" /> : engineBias === 'down' ? <TrendingDown className="w-3.5 h-3.5 text-red-600" /> : <Minus className="w-3.5 h-3.5 text-slate-400" /> },
          { l: 'Chain resistance', v: chain?.resistance ?? '—', ic: <Layers className="w-3.5 h-3.5 text-slate-400" /> },
          { l: 'Chain support', v: chain?.support ?? '—', ic: <Layers className="w-3.5 h-3.5 text-slate-400" /> },
          { l: 'Time window', v: timeWin.label, ic: <Clock className={`w-3.5 h-3.5 ${timeWin.pass ? 'text-emerald-600' : 'text-red-500'}`} /> },
        ].map((x, i) => (
          <div key={i} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-400">{x.ic}{x.l}</div>
            <div className="text-sm font-mono font-semibold text-slate-800 mt-0.5 truncate">{x.v}</div>
          </div>
        ))}
      </div>
      {engineBias && bias && ((engineBias === 'up' && bias === 'down') || (engineBias === 'down' && bias === 'up')) && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-700 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" /> Your 15m bias fights the chain's positioning read. Not a blocker — but demand extra confluence before trusting it.
        </div>
      )}

      {/* GATE 1 */}
      <GateShell index={1} title="Gate 1 — Environment" subtitle="Should I be trading at all today?" passed={gate1Pass}>
        <div className="flex items-center gap-2">
          <input value={ivp} onChange={e => setIvp(e.target.value)} inputMode="decimal" placeholder="IVP"
            className="w-20 bg-white border border-slate-300 rounded-md px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-amber-600" />
          <Check3 state={g1_ivp} locked pass={ivpNum == null ? 'Enter IV percentile · pass if < 75' : ivpNum < 75 ? `IVP ${ivpNum} — fair/cheap` : `IVP ${ivpNum} — expensive, IV-crush risk`} label="IV environment" />
        </div>
        <Check3 state={g1_vix} locked label="Volatility (VIX)"
          pass={vix == null ? 'No VIX supplied on the Analyze tab' : vixSpike ? `VIX ${vix} spiking vs ${vixPrev}` : vixHigh ? `VIX ${vix} elevated` : `VIX ${vix} stable`} />
        <Check3 state={g1_events} locked={isExpiryDay} onCycle={() => setG1(s => ({ ...s, events: cycle(s.events) }))}
          label="No event landmine" pass={isExpiryDay ? 'Expiry day — red flag by itself' : 'RBI / Fed / CPI / earnings / expiry — tap to confirm none'} />
        <Check3 state={g1_time} locked label="Time window"
          pass={timeWin.note} />
        <Check3 state={g1_global} locked={riskOff} onCycle={() => setG1(s => ({ ...s, global: cycle(s.global) }))}
          label="Global backdrop" pass={riskOff ? `GIFT ${giftDrift.toFixed(2)}% — broad risk-off` : giftDrift != null ? `GIFT ${giftDrift.toFixed(2)}% — tap to confirm not risk-off` : 'Tap if not broad risk-off'} />
      </GateShell>

      {/* GATE 2 */}
      <GateShell index={2} title="Gate 2 — Setup" subtitle="Structure → Level → Candle → Confirmation" locked={!gate1Pass} passed={gate2Pass}>
        <div>
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400 mb-1.5">15m structure → bias</div>
          <div className="grid grid-cols-3 gap-2">
            {[['up', 'Uptrend', 'Long only', <TrendingUp className="w-4 h-4" />],
              ['down', 'Downtrend', 'Short only', <TrendingDown className="w-4 h-4" />],
              ['range', 'Range', 'Wait', <Minus className="w-4 h-4" />]].map(([k, t, s, ic]) => (
              <button key={k} disabled={!gate1Pass} onClick={() => setBias(k)}
                className={`rounded-lg border px-2 py-2 text-center transition ${bias === k ? (k === 'range' ? clsFail : clsPass) : clsIdle} ${!gate1Pass ? 'opacity-50' : 'hover:border-slate-400'}`}>
                <div className="flex items-center justify-center mb-0.5">{ic}</div>
                <div className="text-xs font-semibold">{t}</div>
                <div className="text-[10px] font-mono text-slate-500">{s}</div>
              </button>
            ))}
          </div>
          {sug?.bias && (
            <div className="mt-1.5 text-[11px] font-mono text-slate-500 flex items-center gap-1.5">
              <Activity className="w-3 h-3 text-amber-600" />
              Engine leans <b className={sug.bias === 'up' ? 'text-emerald-700' : 'text-red-700'}>{sug.bias === 'up' ? 'long' : 'short'}</b> — but confirm it on the 15m yourself; the chain is positioning, not structure.
            </div>
          )}
        </div>

        <div className="pt-1">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400 mb-1.5">A level that matters — 5-factor check</div>
          <div className="space-y-1.5">
            {factorKeys.map(([k, txt]) => (
              <label key={k} className={`flex items-center gap-2 text-[12px] px-2 py-1.5 rounded-md border cursor-pointer ${level.factors[k] ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-600'} ${!gate1Pass ? 'opacity-50 pointer-events-none' : ''}`}>
                <input type="checkbox" checked={!!level.factors[k]} onChange={e => setLevel(s => ({ ...s, factors: { ...s.factors, [k]: e.target.checked } }))} className="accent-emerald-600" />
                {txt}
              </label>
            ))}
          </div>
          {chain && (chain.resistance || chain.support) && (
            <div className="mt-2 text-[11px] font-mono text-slate-500 bg-slate-50 border border-slate-200 rounded-md px-2 py-1.5">
              Hidden edge — chain confluence: {chain.support && <>Put-OI support <b className="text-emerald-700">{chain.support}</b></>}{chain.support && chain.resistance ? ' · ' : ''}{chain.resistance && <>Call-OI resistance <b className="text-red-700">{chain.resistance}</b></>}. If your zone lines up with one of these, tick “confluence”.
            </div>
          )}
          <div className="mt-2">
            <Check3 state={level.atLevel} locked={!gate1Pass} onCycle={() => setLevel(s => ({ ...s, atLevel: cycle(s.atLevel) }))}
              label="Price is AT the zone now" pass={factorCount < 2 ? `Only ${factorCount}/5 factors — needs ≥2` : `${factorCount}/5 factors stacked`} />
          </div>
        </div>

        <div className="pt-1">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400 mb-1.5">Candle trigger (only at a level that matters)</div>
          <div className="grid grid-cols-3 gap-2 mb-2">
            {[['pin', 'Pin bar'], ['engulf', 'Engulfing'], ['maru', 'Marubozu']].map(([k, t]) => (
              <button key={k} disabled={!gate1Pass} onClick={() => setCandle(c => ({ type: k, dir: c?.dir || (bias === 'down' ? 'bear' : 'bull') }))}
                className={`rounded-lg border px-2 py-2 text-xs font-semibold transition ${candle?.type === k ? clsPass : clsIdle} ${!gate1Pass ? 'opacity-50' : 'hover:border-slate-400'}`}>{t}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[['bull', 'Bullish'], ['bear', 'Bearish']].map(([k, t]) => (
              <button key={k} disabled={!gate1Pass || !candle} onClick={() => setCandle(c => ({ ...c, dir: k }))}
                className={`rounded-lg border px-2 py-1.5 text-xs font-semibold transition ${candle?.dir === k ? clsPass : clsIdle} ${(!gate1Pass || !candle) ? 'opacity-50' : 'hover:border-slate-400'}`}>{t}</button>
            ))}
          </div>
          {candle && !candleAgrees && (
            <div className="mt-1.5 text-[11px] text-red-600 font-mono">Candle direction disagrees with your bias — the golden rule fails. Stand aside.</div>
          )}
        </div>

        <Check3 state={g2_bos} locked={!gate1Pass} onCycle={() => setBos(cycle(bos))}
          label="LTF confirmation — BOS" pass="Lower timeframe broke structure in your direction (conservative entry)" />
      </GateShell>

      {/* GATE 3 */}
      <GateShell index={3} title="Gate 3 — Execution" subtitle="R:R · Strike · Emotion · Mentor" locked={!gate2Pass} passed={gate3Pass}>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400">Reward-to-risk (spot points)</div>
            {sug && (sug.stop != null || sug.target != null) && (
              <button
                disabled={!gate2Pass}
                onClick={() => {
                  setRr({ entry: sug.entry != null ? String(sug.entry) : '', stop: sug.stop != null ? String(sug.stop) : '', target: sug.target != null ? String(sug.target) : '' });
                  if (sug.delta != null) setDelta(String(sug.delta.toFixed(2)));
                }}
                className="text-[10px] font-mono px-2 py-1 rounded border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 disabled:opacity-40"
              >Use engine levels{sug.rr ? ` (${sug.rr})` : ''}</button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 mb-1.5">
            {[['entry', 'Entry'], ['stop', 'Stop'], ['target', 'Target']].map(([k, t]) => (
              <div key={k}>
                <label className="text-[10px] font-mono text-slate-400">{t}</label>
                <input value={rr[k]} disabled={!gate2Pass} onChange={e => setRr(s => ({ ...s, [k]: e.target.value }))} inputMode="decimal"
                  className="w-full bg-white border border-slate-300 rounded-md px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-amber-600 disabled:opacity-50" />
              </div>
            ))}
          </div>
          <Check3 state={g3_rr} locked label="R:R at least 1:2" pass={rrVal == null ? 'Fill entry / stop / target' : `R:R ${rrVal.toFixed(2)} — ${rrVal >= 2 ? 'acceptable' : 'too thin, skip'}`} />
        </div>

        <div className="pt-1 flex items-center gap-2">
          <input value={delta} disabled={!gate2Pass} onChange={e => setDelta(e.target.value)} inputMode="decimal" placeholder="δ"
            className="w-20 bg-white border border-slate-300 rounded-md px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-amber-600 disabled:opacity-50" />
          <Check3 state={g3_strike} locked label="Strike — slight-ITM, 1 lot"
            pass={deltaNum == null
              ? (sug?.delta != null ? `Engine picks ${sug.strike ?? ''} · δ ${sug.delta.toFixed(2)} — enter to confirm` : 'Enter option delta · target 0.55–0.75')
              : deltaNum >= 0.55 && deltaNum <= 0.75 ? `δ ${deltaNum} — in the sweet spot` : `δ ${deltaNum} — ${deltaNum < 0.55 ? 'too far OTM' : 'too deep ITM'}`} />
        </div>

        <div className="pt-1">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400 mb-1.5">Emotional state (1–10)</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
            {[['fear', 'Fear'], ['greed', 'Greed'], ['fomo', 'FOMO'], ['urgency', 'Urgency'], ['calm', 'Calm']].map(([k, t]) => (
              <div key={k} className="flex items-center gap-2">
                <span className="text-[11px] font-mono text-slate-500 w-16">{t}</span>
                <input type="range" min="1" max="10" value={emo[k]} disabled={!gate2Pass} onChange={e => setEmo(s => ({ ...s, [k]: parseInt(e.target.value, 10) }))} className="flex-1 accent-amber-600" />
                <span className="text-xs font-mono font-bold text-slate-700 w-5 text-right">{emo[k]}</span>
              </div>
            ))}
          </div>
          <div className={`mt-1 text-[11px] font-mono ${g3_emo === 'yes' ? 'text-emerald-600' : 'text-red-600'}`}>
            {g3_emo === 'yes' ? 'Calm high, FOMO/urgency low — clear to act.' : 'FOMO/urgency too high or calm too low — this is when you make the Day-2 trade.'}
          </div>
        </div>

        <Check3 state={g3_mentor} locked={!gate2Pass} onCycle={() => setMentor(cycle(mentor))}
          label="Mentor Check Rule" pass="Written plan + chart + chain screenshots sent, confirmation received (or 15 min → setup dies)" />
      </GateShell>

      {/* VERDICT */}
      <div className={`rounded-xl border-2 card-shadow p-5 ${vColor}`}>
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0">{verdict.icon}</div>
          <div className="min-w-0">
            <div className="text-[10px] font-mono uppercase tracking-widest opacity-70">Decision</div>
            <div className="text-2xl font-bold leading-none">{verdict.label}</div>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            {['walk', 'wait', 'skip', 'trade'].map((k, i) => (
              <div key={k} className={`w-2 h-2 rounded-full ${verdict.key === k ? 'bg-current' : 'bg-current opacity-20'}`} />
            ))}
          </div>
        </div>
        <p className="text-sm mt-2 leading-relaxed opacity-90">{verdict.note}</p>
        {cbBlocked && verdict.key === 'trade' && (
          <p className="text-sm mt-2 font-semibold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Circuit breaker is active — even a clean setup does not override the break. Close the platform.</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={copyThesis} className="inline-flex items-center gap-1.5 text-xs font-medium bg-white/70 hover:bg-white border border-current/20 rounded-md px-3 py-1.5">
            <ClipboardCopy className="w-3.5 h-3.5" /> {copied ? 'Copied' : 'Copy trade thesis'}
          </button>
          <button onClick={saveToJournal} className="inline-flex items-center gap-1.5 text-xs font-medium bg-white/70 hover:bg-white border border-current/20 rounded-md px-3 py-1.5">
            <Check className="w-3.5 h-3.5" /> {journalSaved ? 'Saved to journal' : 'Log this decision'}
          </button>
        </div>
        <div className="mt-2 text-[10px] font-mono opacity-70">2-hour rule: log entry/exit/emotion within 2h of any trade — your memory of your own trades degrades fast.</div>
      </div>

      {/* REFERENCE */}
      <Accordion title="Candle reading — the only three that matter" icon={<Activity className="w-4 h-4 text-slate-400" />}>
        <p>Bodies show conviction; wicks show rejection. A pattern only means something <span className="font-semibold">at a location that matters</span> — mid-range it is noise.</p>
        <div className="grid gap-2">
          {[['Pin bar / hammer', 'One candle, small body, one long dominant wick. Rejection from an extreme — bullish at support, bearish at resistance.'],
            ['Engulfing', 'Two candles, a body that fully swallows the prior body. A decisive takeover in the swallow direction.'],
            ['Marubozu / momentum', 'Big body, tiny wicks. Pure conviction — what should confirm a BOS.']].map(([t, d]) => (
            <div key={t} className="rounded-md border border-slate-200 px-3 py-2">
              <div className="text-[12px] font-semibold text-slate-700">{t}</div>
              <div className="text-[11px] text-slate-500">{d}</div>
            </div>
          ))}
        </div>
      </Accordion>

      <Accordion title="The 6-step entry framework" icon={<ArrowRight className="w-4 h-4 text-slate-400" />}>
        <ol className="list-decimal list-inside space-y-1 text-[13px]">
          <li>15m structure → bias (uptrend = long only, downtrend = short only, range = wait)</li>
          <li>Mark the levels that matter (higher lows, lower highs, polarity flips, OI walls)</li>
          <li>Wait for price to reach a level — do not chase mid-range</li>
          <li>Read the candle at the level — pin bar / engulfing in bias direction</li>
          <li>Confirm with a BOS on the lower timeframe</li>
          <li>Enter in the direction of the higher-timeframe bias, then manage + Mentor Check</li>
        </ol>
      </Accordion>
    </div>
  );
}
