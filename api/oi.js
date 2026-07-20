// /api/oi — intraday OI time-series (for the Sensibull-style time scrubber).
//   GET  /api/oi?op=record&key=SECRET     → snapshot the chain now (called by an EXTERNAL
//                                            scheduler every minute during market hours).
//   GET  /api/oi?op=history&symbol=NIFTY&date=YYYY-MM-DD  → the day's snapshots (browser, auth).
//   POST /api/oi?op=token  body={clientId, accessToken, symbols:[...]}  → persist Dhan creds so
//                                            the recorder can fetch without the browser (auth).
//
// Storage (Upstash/KV):
//   dhan-creds                  → {clientId, accessToken, symbols} (TTL ~16h, one trading day)
//   oi:<SYMBOL>:<YYYY-MM-DD>    → Redis list of compact snapshots {t, s, d:[[strike,ceOi,peOi]]}
// The recorder is secret-gated (RECORDER_SECRET env), NOT session-gated, so the scheduler can
// hit it. history/token are session-gated to the logged-in user.

import { kv } from '@vercel/kv';
import { requireAuth } from './_lib/auth.js';

async function readBody(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function kvConfigured() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

// IST wall-clock helpers (server runs in UTC).
function istParts() {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
  return {
    date: ist.toISOString().slice(0, 10),                 // YYYY-MM-DD in IST
    mins: ist.getUTCHours() * 60 + ist.getUTCMinutes(),   // minutes since IST midnight
    day: ist.getUTCDay(),                                 // 0 Sun .. 6 Sat (IST)
  };
}

export default async function handler(req, res) {
  if (!kvConfigured()) return res.status(503).json({ error: 'Storage not configured (KV_REST_API_URL / KV_REST_API_TOKEN).' });
  const op = (req.query?.op || '').toString();

  try {
    // ─── RECORD (external scheduler; secret-gated) ───────────────────────────
    if (op === 'record') {
      const secret = process.env.RECORDER_SECRET;
      if (!secret) return res.status(503).json({ error: 'RECORDER_SECRET not set on the server.' });
      if ((req.query?.key || '') !== secret) return res.status(401).json({ error: 'Bad key.' });

      const { date, mins, day } = istParts();
      const open = 9 * 60 + 15, close = 15 * 60 + 30;
      if (!(day >= 1 && day <= 5 && mins >= open && mins <= close)) {
        return res.status(200).json({ ok: true, skipped: 'market closed', istDate: date, istMins: mins });
      }

      const creds = await kv.get('dhan-creds');
      if (!creds || !creds.accessToken || !creds.clientId) {
        return res.status(200).json({ ok: true, skipped: 'no stored Dhan creds — open the app and re-enter the token today' });
      }
      const symbols = (Array.isArray(creds.symbols) && creds.symbols.length ? creds.symbols : ['NIFTY']).slice(0, 3);

      const base = `https://${req.headers.host}`;
      const results = [];
      for (const symbol of symbols) {
        try {
          const r = await fetch(`${base}/api/dhan-chain?symbol=${encodeURIComponent(symbol)}`, {
            headers: { 'x-dhan-access-token': creds.accessToken, 'x-dhan-client-id': creds.clientId },
          });
          const j = await r.json();
          if (!r.ok) { results.push({ symbol, error: j.error || `HTTP ${r.status}` }); continue; }
          const rows = j?.records?.data || [];
          const spot = j?.records?.underlyingValue ?? null;
          if (!rows.length || spot == null) { results.push({ symbol, error: 'empty chain' }); continue; }
          // Compact snapshot: only strike + call OI + put OI (what the chart needs).
          const d = rows.map(rw => [rw.strikePrice, rw.CE?.openInterest || 0, rw.PE?.openInterest || 0]);
          const snap = { t: Math.floor(Date.now() / 1000), s: spot, d };
          const key = `oi:${symbol.toUpperCase()}:${date}`;
          await kv.rpush(key, JSON.stringify(snap));
          await kv.expire(key, 3 * 24 * 3600); // self-clean after 3 days
          results.push({ symbol, strikes: d.length, spot });
        } catch (e) {
          results.push({ symbol, error: e.message });
        }
      }
      return res.status(200).json({ ok: true, istDate: date, recorded: results });
    }

    // ─── HISTORY (browser; session-gated) ────────────────────────────────────
    if (op === 'history') {
      const user = await requireAuth(req, res);
      if (!user) return;
      const symbol = (req.query?.symbol || 'NIFTY').toString().toUpperCase();
      const date = (req.query?.date || istParts().date).toString();
      const key = `oi:${symbol}:${date}`;
      const raw = await kv.lrange(key, 0, -1);
      const snapshots = (raw || []).map(s => { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return null; } }).filter(Boolean);
      return res.status(200).json({ symbol, date, count: snapshots.length, snapshots });
    }

    // ─── TOKEN (browser; session-gated) ──────────────────────────────────────
    if (op === 'token') {
      const user = await requireAuth(req, res);
      if (!user) return;
      if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
      let body;
      try { body = await readBody(req); } catch { return res.status(400).json({ error: 'Invalid JSON.' }); }
      if (!body?.clientId || !body?.accessToken) return res.status(400).json({ error: 'clientId and accessToken required.' });
      const symbols = Array.isArray(body.symbols) && body.symbols.length ? body.symbols.map(s => String(s).toUpperCase()) : ['NIFTY'];
      await kv.set('dhan-creds', { clientId: body.clientId, accessToken: body.accessToken, symbols }, { ex: 16 * 3600 });
      return res.status(200).json({ ok: true, symbols });
    }

    return res.status(400).json({ error: 'Unknown op. Use record | history | token.' });
  } catch (e) {
    return res.status(500).json({ error: `OI store error: ${e.message}` });
  }
}
