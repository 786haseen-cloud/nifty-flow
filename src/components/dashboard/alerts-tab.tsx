'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Bell, BellRing, Plus, Trash2, Volume2, VolumeX, Chrome,
} from 'lucide-react';
import type { StrikeFlowData } from '@/lib/kite-api';

// ═══════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════

const SYMBOLS = [
  'NIFTY', 'BANKNIFTY', 'SENSEX', 'FINNIFTY',
  'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK',
  'HINDUNILVR', 'SBIN', 'BHARTIARTL', 'ITC', 'KOTAKBANK',
  'LT', 'AXISBANK', 'BAJFINANCE', 'MARUTI', 'TATAMOTORS',
];

const CATEGORIES = ['CE Buy', 'CE Write', 'PE Buy', 'PE Write', 'Cash', 'Future', 'Net Flow'] as const;
type Category = (typeof CATEGORIES)[number];
const CONDITIONS = ['>', '<'] as const;
type Condition = (typeof CONDITIONS)[number];

interface AlertRule {
  id: string;
  symbol: string;
  category: Category;
  condition: Condition;
  threshold: number;
  sound: boolean;
  notification: boolean;
  active: boolean;
  summary: string;
}

interface AlertLogEntry {
  id: string;
  timestamp: string;
  symbol: string;
  category: string;
  value: number;
  threshold: number;
  condition: string;
  ruleId: string;
}

interface SymbolSnapshot {
  symbol: string;
  spotPrice: number;
  spotVolume: number;
  spotChange: number;
  futOI: number;
  futPrice: number;
  futLotSize: number;
  lotSize: number;
  strikeStep: number;
  strikes: StrikeFlowData[];
}

interface BatchResponse {
  mode: string;
  timestamp: string;
  symbols: SymbolSnapshot[];
}

interface ComputedFlows {
  [symbol: string]: {
    ceBuy: number;
    ceWrite: number;
    peBuy: number;
    peWrite: number;
    cash: number;
    future: number;
    netFlow: number;
  };
}

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function toIST(isoStr: string): string {
  const d = new Date(isoStr);
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  const ist = new Date(utc + 5.5 * 60 * 60 * 1000);
  return ist.toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, timeZone: 'UTC',
  });
}

function playBeep() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.value = 0.3;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.stop(ctx.currentTime + 0.5);
  } catch {
    // Audio not available
  }
}

// ═══════════════════════════════════════════
// 4-COLOR FLOW ENGINE
// ═══════════════════════════════════════════

const DIVISOR = 10000000;

function computeStrikeFlow(
  prev: StrikeFlowData,
  curr: StrikeFlowData,
  lotSize: number,
): { ceBuy: number; ceWrite: number; peBuy: number; peWrite: number } {
  const dceOI = curr.ceOI - prev.ceOI;
  const dceP = curr.ceLTP - prev.ceLTP;
  let ceBuy = 0, ceWrite = 0;

  if (dceOI > 0 && dceP >= 0) {
    ceBuy = (dceOI * curr.ceDelta * lotSize) / DIVISOR;
  } else if (dceOI > 0 && dceP < 0) {
    ceWrite = (dceOI * curr.ceDelta * lotSize) / DIVISOR;
  } else if (dceOI < 0 && dceP < 0) {
    ceWrite = (Math.abs(dceOI) * curr.ceDelta * lotSize * 0.3) / DIVISOR;
  } else if (dceOI < 0 && dceP >= 0) {
    ceBuy = (Math.abs(dceOI) * curr.ceDelta * lotSize * 0.3) / DIVISOR;
  }
  if (ceBuy === 0 && ceWrite === 0 && (curr.ceVol - prev.ceVol) > 0) {
    if (dceP >= 0) ceBuy = (curr.ceVol * curr.ceDelta * lotSize * 0.4) / DIVISOR;
    else ceWrite = (curr.ceVol * curr.ceDelta * lotSize * 0.4) / DIVISOR;
  }

  const dpeOI = curr.peOI - prev.peOI;
  const dpeP = curr.peLTP - prev.peLTP;
  let peBuy = 0, peWrite = 0;

  if (dpeOI > 0 && dpeP <= 0) {
    peBuy = (dpeOI * curr.peDelta * lotSize) / DIVISOR;
  } else if (dpeOI > 0 && dpeP > 0) {
    peWrite = (dpeOI * curr.peDelta * lotSize) / DIVISOR;
  } else if (dpeOI < 0 && dpeP > 0) {
    peWrite = (Math.abs(dpeOI) * curr.peDelta * lotSize * 0.3) / DIVISOR;
  } else if (dpeOI < 0 && dpeP <= 0) {
    peBuy = (Math.abs(dpeOI) * curr.peDelta * lotSize * 0.3) / DIVISOR;
  }
  if (peBuy === 0 && peWrite === 0 && (curr.peVol - prev.peVol) > 0) {
    if (dpeP <= 0) peBuy = (curr.peVol * curr.peDelta * lotSize * 0.4) / DIVISOR;
    else peWrite = (curr.peVol * curr.peDelta * lotSize * 0.4) / DIVISOR;
  }

  return { ceBuy, ceWrite, peBuy, peWrite };
}

function computeAllFlows(
  prevSnap: Map<string, SymbolSnapshot>,
  currSnap: Map<string, SymbolSnapshot>,
): ComputedFlows {
  const flows: ComputedFlows = {};

  for (const [sym, curr] of currSnap) {
    const prev = prevSnap.get(sym);
    let ceBuy = 0, ceWrite = 0, peBuy = 0, peWrite = 0;
    let cash = 0, future = 0;

    if (prev) {
      // Options flow
      const prevMap = new Map(prev.strikes.map(s => [s.strike, s]));
      for (const cStrike of curr.strikes) {
        const pStrike = prevMap.get(cStrike.strike);
        if (pStrike) {
          const sf = computeStrikeFlow(pStrike, cStrike, curr.lotSize);
          ceBuy += sf.ceBuy;
          ceWrite += sf.ceWrite;
          peBuy += sf.peBuy;
          peWrite += sf.peWrite;
        }
      }
      // Cash flow: volume delta × price
      const volDelta = curr.spotVolume - prev.spotVolume;
      cash = (volDelta * curr.spotPrice) / DIVISOR;
      // Future flow: OI change
      future = (curr.futOI - prev.futOI) / DIVISOR;
    }

    const netFlow = ceBuy - ceWrite - peBuy + peWrite;
    flows[sym] = { ceBuy, ceWrite, peBuy, peWrite, cash, future, netFlow };
  }
  return flows;
}

function generateDemoFlows(): ComputedFlows {
  const flows: ComputedFlows = {};
  for (const sym of SYMBOLS) {
    const ceBuy = Math.round(Math.random() * 200);
    const ceWrite = Math.round(Math.random() * 150);
    const peBuy = Math.round(Math.random() * 180);
    const peWrite = Math.round(Math.random() * 120);
    const cash = Math.round(Math.random() * 500);
    const future = Math.round(Math.random() * 100);
    flows[sym] = { ceBuy, ceWrite, peBuy, peWrite, cash, future, netFlow: ceBuy - ceWrite - peBuy + peWrite };
  }
  return flows;
}

// ═══════════════════════════════════════════
// CATEGORY → FLOW KEY MAPPER
// ═══════════════════════════════════════════

function getFlowValue(flows: ComputedFlows, symbol: string, category: Category): number {
  const f = flows[symbol];
  if (!f) return 0;
  const map: Record<Category, keyof ComputedFlows[string]> = {
    'CE Buy': 'ceBuy',
    'CE Write': 'ceWrite',
    'PE Buy': 'peBuy',
    'PE Write': 'peWrite',
    Cash: 'cash',
    Future: 'future',
    'Net Flow': 'netFlow',
  };
  return Math.abs(f[map[category]]);
}

// ═══════════════════════════════════════════
// STORAGE HELPERS
// ═══════════════════════════════════════════

function loadRules(): AlertRule[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem('alert-rules') || '[]'); } catch { return []; }
}

function saveRules(rules: AlertRule[]) {
  localStorage.setItem('alert-rules', JSON.stringify(rules));
}

function loadLog(): AlertLogEntry[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem('alerts-log') || '[]'); } catch { return []; }
}

function saveLog(log: AlertLogEntry[]) {
  localStorage.setItem('alerts-log', JSON.stringify(log.slice(0, 50)));
}

// ═══════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════

export default function AlertsTab() {
  // Form state
  const [formSymbol, setFormSymbol] = useState('NIFTY');
  const [formCategory, setFormCategory] = useState<Category>('CE Buy');
  const [formCondition, setFormCondition] = useState<Condition>('>');
  const [formThreshold, setFormThreshold] = useState(50);
  const [formSound, setFormSound] = useState(true);
  const [formNotif, setFormNotif] = useState(false);

  // Rules & log (lazy init from localStorage)
  const [rules, setRules] = useState<AlertRule[]>(() => loadRules());
  const [alertLog, setAlertLog] = useState<AlertLogEntry[]>(() => loadLog());
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) return Notification.permission;
    return 'default';
  });
  const [notificationsSent, setNotificationsSent] = useState(0);
  const [mode, setMode] = useState<string>('');

  // Snapshots
  const prevSnapRef = useRef<Map<string, SymbolSnapshot>>(new Map());
  const currSnapRef = useRef<Map<string, SymbolSnapshot>>(new Map());
  const triggeredThisCycleRef = useRef<Set<string>>(new Set());

  // Persist rules
  useEffect(() => { saveRules(rules); }, [rules]);
  useEffect(() => { saveLog(alertLog); }, [alertLog]);

  // Request notification permission
  const requestNotif = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    const perm = await Notification.requestPermission();
    setNotifPerm(perm);
  }, []);

  // Add rule
  const addRule = useCallback(() => {
    const summary = `${formSymbol} ${formCategory} ${formCondition} ${formThreshold} Cr`;
    const rule: AlertRule = {
      id: uid(),
      symbol: formSymbol,
      category: formCategory,
      condition: formCondition,
      threshold: formThreshold,
      sound: formSound,
      notification: formNotif,
      active: true,
      summary,
    };
    setRules(prev => [...prev, rule]);
  }, [formSymbol, formCategory, formCondition, formThreshold, formSound, formNotif]);

  // Toggle rule
  const toggleRule = useCallback((id: string) => {
    setRules(prev => prev.map(r => r.id === id ? { ...r, active: !r.active } : r));
  }, []);

  // Delete rule
  const deleteRule = useCallback((id: string) => {
    setRules(prev => prev.filter(r => r.id !== id));
  }, []);

  // Fire alert
  const fireAlert = useCallback((rule: AlertRule, value: number) => {
    const entry: AlertLogEntry = {
      id: uid(),
      timestamp: new Date().toISOString(),
      symbol: rule.symbol,
      category: rule.category,
      value: Math.round(value * 100) / 100,
      threshold: rule.threshold,
      condition: rule.condition,
      ruleId: rule.id,
    };
    setAlertLog(prev => [entry, ...prev].slice(0, 50));

    if (rule.sound) playBeep();

    if (rule.notification && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(`Alert: ${rule.summary}`, {
          body: `${rule.symbol} ${rule.category} = ${value.toFixed(1)} Cr (threshold: ${rule.threshold} Cr)`,
          icon: '/logo.svg',
        });
        setNotificationsSent(n => n + 1);
      } catch {
        // Notification failed
      }
    }
  }, []);

  // Check rules against flows
  const checkAlerts = useCallback((flows: ComputedFlows) => {
    const triggered = new Set<string>();

    for (const rule of rules) {
      if (!rule.active) continue;
      if (triggeredThisCycleRef.current.has(rule.id)) continue;

      const value = getFlowValue(flows, rule.symbol, rule.category);
      let match = false;
      if (rule.condition === '>') match = value > rule.threshold;
      else match = value < rule.threshold;

      if (match) {
        triggered.add(rule.id);
        fireAlert(rule, value);
      }
    }

    triggeredThisCycleRef.current = triggered;
  }, [rules, fireAlert]);

  // Polling effect
  useEffect(() => {
    let cancelled = false;
    const interval = setInterval(async () => {
      if (cancelled) return;

      try {
        const res = await fetch('/api/kite/highest-bet');
        const data: BatchResponse = await res.json();
        if (cancelled) return;

        setMode(data.mode);
        const snapMap = new Map<string, SymbolSnapshot>(
          data.symbols.map(s => [s.symbol, s]),
        );

        if (data.mode === 'demo') {
          const flows = generateDemoFlows();
          checkAlerts(flows);
          return;
        }

        prevSnapRef.current = currSnapRef.current;
        currSnapRef.current = snapMap;

        if (prevSnapRef.current.size > 0) {
          const flows = computeAllFlows(prevSnapRef.current, currSnapRef.current);
          checkAlerts(flows);
        }
      } catch {
        // Fetch failed, silently ignore
      }
    }, 30000);

    // Initial fetch
    (async () => {
      try {
        const res = await fetch('/api/kite/highest-bet');
        const data: BatchResponse = await res.json();
        if (cancelled) return;
        setMode(data.mode);
        const snapMap = new Map<string, SymbolSnapshot>(
          data.symbols.map(s => [s.symbol, s]),
        );
        currSnapRef.current = snapMap;
      } catch { /* ignore */ }
    })();

    return () => { cancelled = true; clearInterval(interval); };
  }, [checkAlerts]);

  // Summary stats
  const activeRules = rules.filter(r => r.active).length;
  const todayStr = new Date().toISOString().slice(0, 10);
  const alertsToday = alertLog.filter(e => e.timestamp.slice(0, 10) === todayStr).length;

  // Category badge color
  const catColor = (cat: Category) => {
    if (cat === 'CE Buy') return 'bg-emerald-600/30 text-emerald-400 border-emerald-500/40';
    if (cat === 'CE Write') return 'bg-red-600/30 text-red-400 border-red-500/40';
    if (cat === 'PE Buy') return 'bg-red-600/30 text-red-400 border-red-500/40';
    if (cat === 'PE Write') return 'bg-emerald-600/30 text-emerald-400 border-emerald-500/40';
    if (cat === 'Cash') return 'bg-sky-600/30 text-sky-400 border-sky-500/40';
    if (cat === 'Future') return 'bg-violet-600/30 text-violet-400 border-violet-500/40';
    return 'bg-amber-600/30 text-amber-400 border-amber-500/40';
  };

  const inputCls = 'bg-card border border-border/30 rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/50';

  return (
    <section className="space-y-3" aria-label="Alerts Configuration">
      {/* ── Summary Bar ── */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline" className="bg-emerald-600/20 text-emerald-400 border-emerald-500/30">
          {activeRules} active rule{activeRules !== 1 ? 's' : ''}
        </Badge>
        <Badge variant="outline" className="bg-amber-600/20 text-amber-400 border-amber-500/30">
          {alertsToday} alert{alertsToday !== 1 ? 's' : ''} today
        </Badge>
        <Badge variant="outline" className="bg-sky-600/20 text-sky-400 border-sky-500/30">
          {notificationsSent} notification{notificationsSent !== 1 ? 's' : ''} sent
        </Badge>
        {mode && (
          <Badge variant="outline" className={
            mode === 'demo'
              ? 'bg-orange-600/20 text-orange-400 border-orange-500/30'
              : 'bg-emerald-600/20 text-emerald-400 border-emerald-500/30'
          }>
            {mode === 'demo' ? 'DEMO' : 'LIVE'}
          </Badge>
        )}
      </div>

      {/* ── Create Rule Form ── */}
      <div className="bg-card/60 border border-border/40 rounded-lg p-3 space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground/80">
          <Plus className="w-3 h-3 text-amber-400" />
          Create Alert Rule
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] text-muted-foreground">Symbol</label>
            <select
              className={inputCls + ' min-w-[110px]'}
              value={formSymbol}
              onChange={e => setFormSymbol(e.target.value)}
            >
              {SYMBOLS.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] text-muted-foreground">Category</label>
            <select
              className={inputCls + ' min-w-[100px]'}
              value={formCategory}
              onChange={e => setFormCategory(e.target.value as Category)}
            >
              {CATEGORIES.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] text-muted-foreground">Condition</label>
            <select
              className={inputCls + ' w-[56px]'}
              value={formCondition}
              onChange={e => setFormCondition(e.target.value as Condition)}
            >
              {CONDITIONS.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] text-muted-foreground">Threshold (Cr)</label>
            <input
              type="number"
              className={inputCls + ' w-[72px]'}
              min={0.1}
              step={0.1}
              value={formThreshold}
              onChange={e => setFormThreshold(Number(e.target.value))}
            />
          </div>
          {/* Toggles */}
          <button
            type="button"
            onClick={() => setFormSound(!formSound)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] border transition-colors ${
              formSound
                ? 'bg-emerald-600/20 text-emerald-400 border-emerald-500/40'
                : 'bg-card text-muted-foreground border-border/30'
            }`}
          >
            {formSound ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
            Sound
          </button>
          <button
            type="button"
            onClick={() => setFormNotif(!formNotif)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] border transition-colors ${
              formNotif
                ? 'bg-sky-600/20 text-sky-400 border-sky-500/40'
                : 'bg-card text-muted-foreground border-border/30'
            }`}
          >
            {formNotif ? <BellRing className="w-3 h-3" /> : <Bell className="w-3 h-3" />}
            Notif
          </button>
          <Button
            size="sm"
            className="h-7 px-3 text-xs bg-amber-600 hover:bg-amber-500 text-white"
            onClick={addRule}
          >
            <Plus className="w-3 h-3 mr-1" />
            Add
          </Button>
        </div>
      </div>

      {/* ── Notification Permission ── */}
      {notifPerm !== 'granted' && (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[10px] gap-1 border-sky-500/30 text-sky-400 hover:bg-sky-500/10"
            onClick={requestNotif}
          >
            <Chrome className="w-3 h-3" />
            Enable Browser Notifications
          </Button>
          <span className="text-[10px] text-muted-foreground">Required for push alerts</span>
        </div>
      )}

      {/* ── Rules List ── */}
      {rules.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
            Configured Rules ({rules.length})
          </div>
          <div className="max-h-48 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
            {rules.map(rule => (
              <div
                key={rule.id}
                className={`flex items-center gap-2 px-2 py-1.5 rounded border transition-colors ${
                  rule.active
                    ? 'bg-card/80 border-border/30'
                    : 'bg-card/40 border-border/10 opacity-50'
                }`}
              >
                <Badge
                  variant="outline"
                  className={`text-[10px] px-1.5 py-0 border ${catColor(rule.category)}`}
                >
                  {rule.category}
                </Badge>
                <span className="text-xs text-foreground font-mono flex-1 truncate">
                  {rule.symbol} {rule.condition} {rule.threshold} Cr
                </span>
                {rule.sound && <Volume2 className="w-3 h-3 text-muted-foreground shrink-0" />}
                {rule.notification && <Bell className="w-3 h-3 text-muted-foreground shrink-0" />}
                <button
                  onClick={() => toggleRule(rule.id)}
                  className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                    rule.active
                      ? 'bg-emerald-600/20 text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/30'
                      : 'bg-red-600/20 text-red-400 border-red-500/40 hover:bg-red-500/30'
                  }`}
                >
                  {rule.active ? 'ON' : 'OFF'}
                </button>
                <button
                  onClick={() => deleteRule(rule.id)}
                  className="text-red-400/60 hover:text-red-400 transition-colors p-0.5"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Alert Log ── */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
            Alert Log{alertLog.length > 0 ? ` (${alertLog.length})` : ''}
          </div>
          {alertLog.length > 0 && (
            <button
              onClick={() => { setAlertLog([]); setNotificationsSent(0); }}
              className="text-[10px] text-red-400/60 hover:text-red-400 transition-colors"
            >
              Clear All
            </button>
          )}
        </div>
        <div className="max-h-64 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
          {alertLog.length === 0 ? (
            <div className="text-xs text-muted-foreground/50 text-center py-6">
              No alerts triggered yet. Rules will be checked every 30s.
            </div>
          ) : (
            alertLog.map(entry => (
              <div
                key={entry.id}
                className="flex items-center gap-2 px-2 py-1.5 bg-card/60 rounded border border-l-4 border-l-amber-500 border-border/30"
              >
                <span className="text-[10px] text-muted-foreground font-mono shrink-0 w-16">
                  {toIST(entry.timestamp)}
                </span>
                <Badge
                  variant="outline"
                  className={`text-[10px] px-1.5 py-0 border ${catColor(entry.category as Category)}`}
                >
                  {entry.category}
                </Badge>
                <span className="text-xs text-foreground font-mono truncate">
                  {entry.symbol}
                </span>
                <span className="text-xs text-amber-400 font-mono ml-auto shrink-0">
                  {entry.value.toFixed(1)} Cr
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
