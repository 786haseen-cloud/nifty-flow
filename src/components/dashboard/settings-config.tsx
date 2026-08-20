'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Settings, Key, RefreshCw, Target, Sliders, Wifi, WifiOff,
} from 'lucide-react';
import { INDICES, TOP_STOCKS } from '@/lib/types';

export default function SettingsConfig() {
  const [apiKey, setApiKey] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(15);
  const [signalThreshold, setSignalThreshold] = useState(50);
  const [selectedInstruments, setSelectedInstruments] = useState<string[]>(['NIFTY', 'BANKNIFTY']);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [darkMode, setDarkMode] = useState(true);

  const handleConnect = () => {
    if (apiKey && accessToken) {
      setIsConnected(true);
    }
  };

  const toggleInstrument = (symbol: string) => {
    setSelectedInstruments(prev =>
      prev.includes(symbol)
        ? prev.filter(s => s !== symbol)
        : [...prev, symbol]
    );
  };

  return (
    <div className="space-y-4">
      {/* Kite API Config */}
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Key className="h-4 w-4 text-amber-400" />
            Kite API Configuration
            <Badge variant="outline" className={`ml-auto text-xs ${isConnected ? 'border-emerald-500/40 text-emerald-300' : 'border-red-500/40 text-red-300'}`}>
              {isConnected ? <><Wifi className="mr-1 h-3 w-3" />Connected</> : <><WifiOff className="mr-1 h-3 w-3" />Disconnected</>}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs">API Key</Label>
              <Input
                type="password"
                placeholder="Enter your Kite API key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Access Token</Label>
              <Input
                type="password"
                placeholder="Enter access token"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                className="font-mono text-sm"
              />
            </div>
          </div>
          <div className="flex gap-3">
            <Button onClick={handleConnect} disabled={!apiKey || !accessToken} className="text-xs">
              <Wifi className="mr-2 h-3 w-3" />
              Connect
            </Button>
            <Button variant="outline" onClick={() => { setIsConnected(false); setApiKey(''); setAccessToken(''); }} className="text-xs">
              Disconnect
            </Button>
          </div>
          <div className="text-xs text-muted-foreground">
            Note: Without Kite API connection, the dashboard uses realistic demo data for all indicators and signals.
          </div>
        </CardContent>
      </Card>

      {/* Instrument Selection */}
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
                  variant={selectedInstruments.includes(idx.symbol) ? 'default' : 'outline'}
                  className={`cursor-pointer text-xs transition-colors ${
                    selectedInstruments.includes(idx.symbol) ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/50'
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
                  variant={selectedInstruments.includes(stock.symbol) ? 'default' : 'outline'}
                  className={`cursor-pointer text-[10px] transition-colors ${
                    selectedInstruments.includes(stock.symbol) ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/50'
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

      {/* Signal Threshold Tuning */}
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
              <span className="font-mono text-foreground">{signalThreshold}%</span>
            </div>
            <Slider
              value={[signalThreshold]}
              onValueChange={(v) => setSignalThreshold(v[0])}
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

      {/* Refresh Settings */}
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
              <span className="font-mono text-foreground">{refreshInterval}s</span>
            </div>
            <Slider
              value={[refreshInterval]}
              onValueChange={(v) => setRefreshInterval(v[0])}
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
            <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} />
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-xs">Dark Mode</Label>
            <Switch checked={darkMode} onCheckedChange={(v) => {
              setDarkMode(v);
              document.documentElement.classList.toggle('dark', v);
            }} />
          </div>
        </CardContent>
      </Card>

      {/* Data Source Info */}
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings className="h-4 w-4 text-muted-foreground" />
            Data Source
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-xs text-muted-foreground space-y-1">
            <p>• <span className="text-foreground font-medium">Demo Mode</span>: Using realistic simulated data based on Indian market patterns</p>
            <p>• <span className="text-foreground font-medium">Kite API</span>: Connect Zerodha Kite API for live market data</p>
            <p>• <span className="text-foreground font-medium">Signal Engine</span>: Weighted flow analysis, contrarian flow detection, no Theta/VIX in scores</p>
            <p>• <span className="text-foreground font-medium">Cash Flow</span>: Tracks money in/out across NSE + BSE for top-weighted stocks</p>
            <p>• <span className="text-foreground font-medium">Options Flow</span>: Call/Put buying + writing at each strike — bullish vs bearish pressure</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
