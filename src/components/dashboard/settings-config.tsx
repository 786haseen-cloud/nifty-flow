'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  Settings, Key, RefreshCw, Target, Sliders, Wifi, WifiOff,
  Loader2, CheckCircle, XCircle, Eye, EyeOff, Trash2,
} from 'lucide-react';
import { INDICES, TOP_STOCKS } from '@/lib/types';
import { getKiteCreds, setKiteCreds, clearKiteCreds, hasKiteCreds, withCreds, type KiteCredentials } from '@/lib/kite-creds';

// ═══════════════════════════════════════════
// SETTINGS STORAGE
// ═══════════════════════════════════════════

const SETTINGS_KEY = 'dashboard-settings';

interface AppSettings {
  refreshInterval: number;
  signalThreshold: number;
  selectedInstruments: string[];
  autoRefresh: boolean;
  darkMode: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  refreshInterval: 15,
  signalThreshold: 50,
  selectedInstruments: ['NIFTY', 'BANKNIFTY'],
  autoRefresh: true,
  darkMode: true,
};

function loadSettings(): AppSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch { return DEFAULT_SETTINGS; }
}

function saveSettings(s: AppSettings) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  }
}

// ═══════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════

type ConnStatus = 'unknown' | 'testing' | 'live' | 'error' | 'demo';

export default function SettingsConfig() {
  // ── Kite API State ──
  const [apiKey, setApiKey] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [connStatus, setConnStatus] = useState<ConnStatus>('unknown');
  const [connMsg, setConnMsg] = useState('');
  const [testing, setTesting] = useState(false);

  // ── App Settings State ──
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  // Load from localStorage on mount
  useEffect(() => {
    const creds = getKiteCreds();
    setApiKey(creds.apiKey);
    setAccessToken(creds.accessToken);
    setSettings(loadSettings());

    // If we have saved creds, do a background check
    if (creds.apiKey && creds.accessToken) {
      testConnection(creds.apiKey, creds.accessToken);
    }
  }, []);

  // Test connection
  const testConnection = useCallback(async (key?: string, token?: string) => {
    const k = key || apiKey;
    const t = token || accessToken;
    if (!k || !t) return;

    setTesting(true);
    setConnStatus('testing');
    setConnMsg('Testing connection...');

    try {
      const url = withCreds('/api/kite/status');
      const res = await fetch(url);
      const data = await res.json();

      if (data.mode === 'live' && data.connectionTest === 'PASS') {
        setConnStatus('live');
        setConnMsg(`Connected! NIFTY: ${data.niftyLastPrice || '—'}`);
      } else if (data.mode === 'error') {
        setConnStatus('error');
        setConnMsg(data.message || 'Connection failed');
      } else {
        setConnStatus('demo');
        setConnMsg('No credentials');
      }
    } catch (err) {
      setConnStatus('error');
      setConnMsg(err instanceof Error ? err.message : 'Network error');
    } finally {
      setTesting(false);
    }
  }, [apiKey, accessToken]);

  // Save & Connect
  const handleSave = useCallback(() => {
    setKiteCreds(apiKey, accessToken);
    if (apiKey && accessToken) {
      testConnection();
    } else {
      setConnStatus('unknown');
      setConnMsg('');
    }
  }, [apiKey, accessToken, testConnection]);

  // Disconnect
  const handleDisconnect = useCallback(() => {
    clearKiteCreds();
    setApiKey('');
    setAccessToken('');
    setConnStatus('unknown');
    setConnMsg('');
  }, []);

  // Update settings helper
  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    saveSettings(next);
  };

  const toggleInstrument = (symbol: string) => {
    const list = settings.selectedInstruments.includes(symbol)
      ? settings.selectedInstruments.filter(s => s !== symbol)
      : [...settings.selectedInstruments, symbol];
    updateSetting('selectedInstruments', list);
  };

  // Status indicator
  const StatusBadge = () => {
    if (testing) return (
      <Badge variant="outline" className="ml-auto text-xs border-amber-500/40 text-amber-300">
        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        Testing...
      </Badge>
    );
    switch (connStatus) {
      case 'live':
        return (
          <Badge variant="outline" className="ml-auto text-xs border-emerald-500/40 text-emerald-300">
            <CheckCircle className="mr-1 h-3 w-3" />
            LIVE Connected
          </Badge>
        );
      case 'error':
        return (
          <Badge variant="outline" className="ml-auto text-xs border-red-500/40 text-red-300">
            <XCircle className="mr-1 h-3 w-3" />
            Error
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className={`ml-auto text-xs ${hasKiteCreds() ? 'border-amber-500/40 text-amber-300' : 'border-red-500/40 text-red-300'}`}>
            {hasKiteCreds() ? <><Wifi className="mr-1 h-3 w-3" />Saved (not tested)</> : <><WifiOff className="mr-1 h-3 w-3" />No Credentials</>}
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* ══ Kite API Configuration ══ */}
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Key className="h-4 w-4 text-amber-400" />
            Kite API Configuration
            <StatusBadge />
          </CardTitle>
          {connMsg && connStatus !== 'unknown' && (
            <p className={`text-xs mt-1 ${connStatus === 'live' ? 'text-emerald-400' : connStatus === 'error' ? 'text-red-400' : 'text-amber-400'}`}>
              {connMsg}
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs">API Key</Label>
              <div className="relative">
                <Input
                  type={showKey ? 'text' : 'password'}
                  placeholder="Paste your Kite API key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="font-mono text-sm pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Access Token <span className="text-muted-foreground/60">(expires daily at midnight IST)</span></Label>
              <div className="relative">
                <Input
                  type={showToken ? 'text' : 'password'}
                  placeholder="Paste your access token"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  className="font-mono text-sm pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <Button
              onClick={handleSave}
              disabled={!apiKey || !accessToken || testing}
              className="text-xs"
            >
              {testing ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Wifi className="mr-2 h-3 w-3" />}
              {testing ? 'Testing...' : 'Save & Test'}
            </Button>
            <Button
              variant="outline"
              onClick={handleDisconnect}
              className="text-xs"
            >
              <Trash2 className="mr-2 h-3 w-3" />
              Clear Credentials
            </Button>
            {apiKey && accessToken && !testing && connStatus !== 'testing' && (
              <Button
                variant="ghost"
                onClick={() => testConnection()}
                className="text-xs"
              >
                <RefreshCw className="mr-2 h-3 w-3" />
                Re-test
              </Button>
            )}
          </div>
          <div className="text-xs text-muted-foreground space-y-1">
            <p>
              <span className="text-foreground font-medium">How to get credentials:</span>{' '}
              Go to <a href="https://kite.zerodha.com/connect/login?v=3&api_key=YOUR_API_KEY" target="_blank" rel="noreferrer" className="text-amber-400 underline underline-offset-2">kite.zerodha.com/connect/login</a> with your API key, login, and copy the <code className="bg-muted px-1 rounded">request_token</code> from the redirect URL.
            </p>
            <p>
              Then call <code className="bg-muted px-1 rounded">/api/kite/auth?request_token=xxx</code> to generate an access token, or paste a pre-generated token directly above.
            </p>
            <p>
              Credentials are saved in your browser&apos;s localStorage — they never leave your device except as query params to your own API routes.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ══ Instrument Selection ══ */}
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-4 w-4 text-blue-400" />
            Instrument Selection
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Label className="text-xs font-medium">Indices</Label>
            <div className="flex flex-wrap gap-2">
              {INDICES.map((idx) => (
                <Badge
                  key={idx.symbol}
                  variant={settings.selectedInstruments.includes(idx.symbol) ? 'default' : 'outline'}
                  className={`cursor-pointer text-xs transition-colors ${
                    settings.selectedInstruments.includes(idx.symbol) ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/50'
                  }`}
                  onClick={() => toggleInstrument(idx.symbol)}
                >
                  {idx.name}
                </Badge>
              ))}
            </div>
            <Label className="text-xs font-medium mt-3">Top F&amp;O Stocks</Label>
            <div className="flex flex-wrap gap-2">
              {TOP_STOCKS.map((stock) => (
                <Badge
                  key={stock.symbol}
                  variant={settings.selectedInstruments.includes(stock.symbol) ? 'default' : 'outline'}
                  className={`cursor-pointer text-[10px] transition-colors ${
                    settings.selectedInstruments.includes(stock.symbol) ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/50'
                  }`}
                  onClick={() => toggleInstrument(stock.symbol)}
                >
                  {stock.symbol}
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ══ Signal Threshold Tuning ══ */}
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sliders className="h-4 w-4 text-purple-400" />
            Signal Threshold Tuning
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <Label>Signal Confidence Threshold</Label>
              <span className="font-mono text-foreground">{settings.signalThreshold}%</span>
            </div>
            <Slider
              value={[settings.signalThreshold]}
              onValueChange={(v) => updateSetting('signalThreshold', v[0])}
              min={20}
              max={90}
              step={5}
              className="w-full"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>Aggressive (20%)</span><span>Conservative (90%)</span>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="p-2 rounded border border-border/30">
              <span className="text-muted-foreground">Net Flow Score</span>
              <div className="font-mono font-bold">25%</div>
            </div>
            <div className="p-2 rounded border border-border/30">
              <span className="text-muted-foreground">F&amp;O Flow</span>
              <div className="font-mono font-bold">20%</div>
            </div>
            <div className="p-2 rounded border border-border/30">
              <span className="text-muted-foreground">Contrarian Flow</span>
              <div className="font-mono font-bold">15%</div>
            </div>
            <div className="p-2 rounded border border-border/30">
              <span className="text-muted-foreground">3-Day OI Trend</span>
              <div className="font-mono font-bold">15%</div>
            </div>
            <div className="p-2 rounded border border-border/30">
              <span className="text-muted-foreground">Cash+Fut Align</span>
              <div className="font-mono font-bold">10%</div>
            </div>
            <div className="p-2 rounded border border-border/30">
              <span className="text-muted-foreground">Global Context</span>
              <div className="font-mono font-bold">10%</div>
            </div>
            <div className="p-2 rounded border border-border/30">
              <span className="text-muted-foreground">Stock Sentiment</span>
              <div className="font-mono font-bold">5%</div>
            </div>
            <div className="p-2 rounded border border-amber-500/30 bg-amber-500/10">
              <span className="text-amber-300">Theta + VIX</span>
              <div className="font-mono font-bold text-amber-300">0% (Info)</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ══ Refresh Settings ══ */}
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <RefreshCw className="h-4 w-4 text-cyan-400" />
            Refresh Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <Label>Auto-Refresh Interval</Label>
              <span className="font-mono text-foreground">{settings.refreshInterval}s</span>
            </div>
            <Slider
              value={[settings.refreshInterval]}
              onValueChange={(v) => updateSetting('refreshInterval', v[0])}
              min={5}
              max={60}
              step={5}
              className="w-full"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>5s (Fast)</span><span>60s (Slow)</span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-xs">Auto-Refresh Enabled</Label>
            <Switch checked={settings.autoRefresh} onCheckedChange={(v) => updateSetting('autoRefresh', v)} />
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-xs">Dark Mode</Label>
            <Switch checked={settings.darkMode} onCheckedChange={(v) => {
              updateSetting('darkMode', v);
              document.documentElement.classList.toggle('dark', v);
            }} />
          </div>
        </CardContent>
      </Card>

      {/* ══ Data Source Info ══ */}
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings className="h-4 w-4 text-muted-foreground" />
            Data Source
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-xs text-muted-foreground space-y-1">
            <p>
              <span className="text-foreground font-medium">Live Mode</span>: Paste API Key + Access Token above and click &quot;Save &amp; Test&quot;.
              All tabs will automatically use live Kite data.
            </p>
            <p>
              <span className="text-foreground font-medium">Demo Mode</span>: Without credentials, dashboard uses realistic simulated data.
            </p>
            <p>
              <span className="text-foreground font-medium">Credential Storage</span>: Saved in browser localStorage only. Never sent to third parties.
              Tokens auto-expire at midnight IST — re-paste each morning.
            </p>
            <p>
              <span className="text-foreground font-medium">Signal Engine</span>: Weighted flow analysis, contrarian flow detection, no Theta/VIX in scores
            </p>
            <p>
              <span className="text-foreground font-medium">Options Flow</span>: Call/Put buying + writing at each strike — bullish vs bearish pressure
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}