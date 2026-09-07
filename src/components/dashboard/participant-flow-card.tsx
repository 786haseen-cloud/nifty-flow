'use client';

/**
 * Participant Flow Card
 * ---------------------
 *
 * Daily FII / DII / Client / PropDesk net buy-sell input + 7-day history chart.
 *
 * This card is the user-facing input for Factor 12 of the magnet engine.
 * The user pastes yesterday's NSE participant-wise numbers (in ₹ Crore)
 * here once a day, and the magnet engine picks them up via
 * /api/participants/daily (which reads from Upstash Redis).
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  Participant Flow — Yesterday's Smart Money                 │
 *   │  ─────────────────────────────────────────────────────────  │
 *   │  Date: [2026-09-07]   Bias: +1.5 (CALL bias)               │
 *   │  FII:    [____] Cr    DII:    [____] Cr                     │
 *   │  Client: [____] Cr    Prop:   [____] Cr        [Save]       │
 *   │  ─────────────────────────────────────────────────────────  │
 *   │  Last 7 days (Cr):                                          │
 *   │  ▆ ▇ ▅ ▆ ▄ ▇ ▆   (FII red, DII green, Client blue, Prop orange) │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * Polls /api/participants/daily every 60s to refresh the bias display
 * and the 7-day chart. Save POSTs to the same endpoint, then refetches.
 *
 * If Upstash is not configured, shows a friendly warning and disables
 * the Save button.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ReferenceLine, ResponsiveContainer,
} from 'recharts';
import { Users, Save, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { withCreds } from '@/lib/kite-creds';

// ─── Types (mirror participant-service.ts) ───

interface ParticipantFlow {
  date: string;          // YYYY-MM-DD
  fii: number;
  dii: number;
  client: number;
  propdesk: number;
  ts: number;
  source?: string;
}

interface ParticipantBiasResult {
  weight: number;
  direction: 'bull' | 'bear' | 'neutral';
  detail: string;
  source: ParticipantFlow | null;
}

interface ParticipantResponse {
  history: ParticipantFlow[];
  bias: ParticipantBiasResult | null;
  configured: boolean;
  error?: string;
}

const POLL_INTERVAL_MS = 60_000; // 60s — bias changes once a day, no need to hammer

// ─── Component ───

export function ParticipantFlowCard() {
  const [data, setData] = useState<ParticipantResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState<string | null>(null);

  // Form state — defaults to yesterday IST
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

  const [formDate, setFormDate] = useState(yesterdayStr);
  const [fii, setFii] = useState('');
  const [dii, setDii] = useState('');
  const [client, setClient] = useState('');
  const [propdesk, setPropdesk] = useState('');

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch(withCreds('/api/participants/daily'), { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json: ParticipantResponse = await res.json();
      setData(json);

      // Pre-fill form with most recent entry if available (so user can
      // quickly update with today's numbers without retyping)
      if (json.bias?.source && !fii) {
        const src = json.bias.source;
        setFormDate(src.date);
        setFii(String(src.fii));
        setDii(String(src.dii));
        setClient(String(src.client));
        setPropdesk(String(src.propdesk));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSaveOk(null);
    try {
      const body = {
        date: formDate,
        fii: parseFloat(fii) || 0,
        dii: parseFloat(dii) || 0,
        client: parseFloat(client) || 0,
        propdesk: parseFloat(propdesk) || 0,
        source: 'manual',
      };
      const res = await fetch(withCreds('/api/participants/daily'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setSaveOk(`Saved ${json.entry?.date ?? formDate} — bias will refresh within 5 min`);
      // Refetch immediately to show the updated history
      await fetchData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setSaving(false);
    }
  }, [formDate, fii, dii, client, propdesk, fetchData]);

  // Build chart data from history (oldest → newest for left-to-right timeline)
  const chartData = (data?.history ?? [])
    .slice()
    .reverse()
    .map((h) => ({
      date: h.date.slice(5), // MM-DD (drop year for compactness)
      FII: h.fii,
      DII: h.dii,
      Client: h.client,
      Prop: h.propdesk,
    }));

  const bias = data?.bias;
  const biasColor = bias && bias.weight > 0.15
    ? 'text-emerald-400'
    : bias && bias.weight < -0.15
    ? 'text-red-400'
    : 'text-muted-foreground';
  const biasLabel = bias
    ? `${bias.weight >= 0 ? '+' : ''}${bias.weight.toFixed(2)} (${bias.direction === 'bull' ? 'CALL bias' : bias.direction === 'bear' ? 'PUT bias' : 'neutral'})`
    : '—';

  const configured = data?.configured ?? false;

  return (
    <div className="rounded-xl border border-border/50 bg-card/50 p-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-semibold">Participant Flow — Yesterday&apos;s Smart Money</h3>
          </div>
          <div className="text-[10px] text-muted-foreground">
            FII / DII / Client / PropDesk net buy-sell (₹ Cr) — feeds Factor 12 of the magnet engine
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] text-muted-foreground">Current Factor 12</div>
          <div className={`text-sm font-mono font-bold ${biasColor}`}>{biasLabel}</div>
        </div>
      </div>

      {/* Not configured warning */}
      {!configured && !loading && (
        <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 p-2.5 text-[11px] text-orange-300 mb-3 flex items-start gap-2">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <div>
            Upstash Redis not configured. Set <code className="bg-black/30 px-1 rounded">UPSTASH_REDIS_REST_URL</code> and
            <code className="bg-black/30 px-1 rounded ml-1">UPSTASH_REDIS_REST_TOKEN</code> env vars in Vercel
            to enable participant flow persistence. Factor 12 will remain neutral (0) until then.
          </div>
        </div>
      )}

      {/* Input form */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Date (IST)</label>
          <input
            type="date"
            value={formDate}
            onChange={(e) => setFormDate(e.target.value)}
            className="w-full h-8 px-2 text-xs bg-background border border-border/50 rounded font-mono"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">FII (Cr)</label>
          <input
            type="number"
            step="any"
            value={fii}
            onChange={(e) => setFii(e.target.value)}
            placeholder="-1200"
            className="w-full h-8 px-2 text-xs bg-background border border-border/50 rounded font-mono"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">DII (Cr)</label>
          <input
            type="number"
            step="any"
            value={dii}
            onChange={(e) => setDii(e.target.value)}
            placeholder="850"
            className="w-full h-8 px-2 text-xs bg-background border border-border/50 rounded font-mono"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Client (Cr)</label>
          <input
            type="number"
            step="any"
            value={client}
            onChange={(e) => setClient(e.target.value)}
            placeholder="400"
            className="w-full h-8 px-2 text-xs bg-background border border-border/50 rounded font-mono"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Prop Desk (Cr)</label>
          <input
            type="number"
            step="any"
            value={propdesk}
            onChange={(e) => setPropdesk(e.target.value)}
            placeholder="-50"
            className="w-full h-8 px-2 text-xs bg-background border border-border/50 rounded font-mono"
          />
        </div>
        <div className="flex items-end">
          <button
            onClick={handleSave}
            disabled={saving || !configured}
            className="h-8 px-3 text-xs font-medium bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {saving ? (
              <>
                <RefreshCw className="h-3 w-3 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-3 w-3" />
                Save
              </>
            )}
          </button>
        </div>
      </div>

      {/* Status messages */}
      {error && (
        <div className="text-[11px] text-red-400 mb-2 flex items-center gap-1.5">
          <AlertCircle className="h-3 w-3" />
          {error}
        </div>
      )}
      {saveOk && (
        <div className="text-[11px] text-emerald-400 mb-2 flex items-center gap-1.5">
          <CheckCircle2 className="h-3 w-3" />
          {saveOk}
        </div>
      )}

      {/* Bias detail string */}
      {bias?.detail && (
        <div className="text-[10px] text-muted-foreground mb-3 font-mono leading-relaxed">
          {bias.detail}
        </div>
      )}

      {/* 7-day history chart */}
      <div className="border-t border-border/30 pt-3">
        <div className="text-[10px] text-muted-foreground mb-2 flex items-center justify-between">
          <span>Last {chartData.length}/7 days — net buy/sell (₹ Cr)</span>
          {chartData.length === 0 && <span className="text-orange-400">No data yet — paste yesterday&apos;s numbers above</span>}
        </div>
        {chartData.length > 0 ? (
          <div className="h-[140px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#a1a1aa', fontSize: 9 }}
                  tickLine={false}
                  axisLine={{ stroke: '#ffffff10' }}
                />
                <YAxis
                  tick={{ fill: '#a1a1aa', fontSize: 9 }}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                  tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`)}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1a1a1a',
                    border: '1px solid #ffffff20',
                    borderRadius: '6px',
                    fontSize: '11px',
                  }}
                  labelStyle={{ color: '#d4d4d8' }}
                />
                <Legend
                  wrapperStyle={{ fontSize: '10px', paddingTop: '4px' }}
                  iconType="square"
                  iconSize={8}
                />
                <ReferenceLine y={0} stroke="#ffffff30" />
                <Bar dataKey="FII" fill="#ef4444" name="FII" radius={[2, 2, 0, 0]} maxBarSize={18} />
                <Bar dataKey="DII" fill="#22c55e" name="DII" radius={[2, 2, 0, 0]} maxBarSize={18} />
                <Bar dataKey="Client" fill="#0ea5e9" name="Client" radius={[2, 2, 0, 0]} maxBarSize={18} />
                <Bar dataKey="Prop" fill="#f59e0b" name="Prop" radius={[2, 2, 0, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-[80px] flex items-center justify-center text-[11px] text-muted-foreground border border-dashed border-border/30 rounded-lg">
            {loading ? 'Loading...' : 'No history yet. Paste yesterday\'s data above to start building history.'}
          </div>
        )}
      </div>
    </div>
  );
}
