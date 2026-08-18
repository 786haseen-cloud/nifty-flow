'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Settings, Key, RefreshCw, Zap, Shield, Save, Wifi, WifiOff } from 'lucide-react';
import { useStore } from '@/lib/store';

export default function SettingsConfig() {
  const {
    kiteConfig, setKiteConfig,
    isLive, setIsLive,
    refreshInterval, setRefreshInterval,
    signalMode, setSignalMode,
    selectedInstrument, setSelectedInstrument,
  } = useStore();

  const [apiKey, setApiKey] = useState(kiteConfig.apiKey);
  const [accessToken, setAccessToken] = useState(kiteConfig.accessToken);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setKiteConfig({ apiKey, accessToken, isConnected: isLive });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <Settings className="h-5 w-5 text-muted-foreground" />
        Settings
      </h2>

      {/* Kite/Zerodha API Config */}
      <Card className="border-border/50">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Key className="h-4 w-4 text-yellow-400" />
            Kite / Zerodha API
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3 space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant={kiteConfig.isConnected ? 'default' : 'secondary'} className="text-[10px]">
              {kiteConfig.isConnected ? <Wifi className="h-3 w-3 mr-1" /> : <WifiOff className="h-3 w-3 mr-1" />}
              {kiteConfig.isConnected ? 'Connected' : 'Disconnected'}
            </Badge>
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">API Key</label>
            <Input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter Kite API Key"
              type="password"
              className="text-xs font-mono"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Access Token</label>
            <Input
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="Enter Kite Access Token"
              type="password"
              className="text-xs font-mono"
            />
          </div>
          <Button size="sm" onClick={handleSave} className="gap-1">
            <Save className="h-3 w-3" />
            {saved ? 'Saved!' : 'Save Credentials'}
          </Button>
        </CardContent>
      </Card>

      {/* Live/Demo Mode */}
      <Card className="border-border/50">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-blue-400" />
            Data Mode
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm">Demo Mode</span>
              <span className="text-xs text-muted-foreground ml-2">(simulated data)</span>
            </div>
            <Switch
              checked={isLive}
              onCheckedChange={setIsLive}
            />
            <div>
              <span className="text-sm">Live Mode</span>
              <span className="text-xs text-muted-foreground ml-2">(Kite API)</span>
            </div>
          </div>
          <div className="text-xs text-yellow-400">
            ⚠ Live mode requires valid Kite credentials
          </div>
        </CardContent>
      </Card>

      {/* Refresh Interval */}
      <Card className="border-border/50">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm font-medium">Refresh Interval</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <Select
            value={refreshInterval.toString()}
            onValueChange={(v) => setRefreshInterval(parseInt(v))}
          >
            <SelectTrigger className="w-40 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="5">5 seconds</SelectItem>
              <SelectItem value="10">10 seconds</SelectItem>
              <SelectItem value="15">15 seconds (default)</SelectItem>
              <SelectItem value="30">30 seconds</SelectItem>
              <SelectItem value="60">60 seconds</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Signal Configuration */}
      <Card className="border-border/50">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Zap className="h-4 w-4 text-yellow-400" />
            Signal Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Shield className="h-3 w-3 text-blue-400" />
              <span className="text-xs">Conservative</span>
            </div>
            <Switch
              checked={signalMode === 'aggressive'}
              onCheckedChange={(checked) => setSignalMode(checked ? 'aggressive' : 'conservative')}
            />
            <div className="flex items-center gap-1">
              <Zap className="h-3 w-3 text-yellow-400" />
              <span className="text-xs">Aggressive</span>
            </div>
          </div>
          <Separator />
          <div className="text-xs text-muted-foreground">
            <strong>Aggressive:</strong> More signals, lower confidence threshold
            <br />
            <strong>Conservative:</strong> Fewer signals, higher confidence required
          </div>
        </CardContent>
      </Card>

      {/* Default Instrument */}
      <Card className="border-border/50">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm font-medium">Default Instrument</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <Select value={selectedInstrument} onValueChange={setSelectedInstrument}>
            <SelectTrigger className="w-48 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NIFTY">NIFTY 50</SelectItem>
              <SelectItem value="BANKNIFTY">BANK NIFTY</SelectItem>
              <SelectItem value="FINNIFTY">FIN NIFTY</SelectItem>
              <SelectItem value="MIDCPNIFTY">MIDCP NIFTY</SelectItem>
              <SelectItem value="RELIANCE">RELIANCE</SelectItem>
              <SelectItem value="HDFCBANK">HDFCBANK</SelectItem>
              <SelectItem value="TCS">TCS</SelectItem>
              <SelectItem value="INFY">INFY</SelectItem>
              <SelectItem value="ICICIBANK">ICICIBANK</SelectItem>
              <SelectItem value="SBIN">SBIN</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* About */}
      <Card className="border-border/50">
        <CardContent className="p-4 text-xs text-muted-foreground space-y-1">
          <div className="font-semibold text-sm text-foreground">Indian Options Trading Dashboard V2</div>
          <div>Built for options traders in Jeddah trading Indian markets via Kite/Zerodha API</div>
          <div>Includes: Live Monitor, Greeks, Signal Engine, Big Money Footprint, Daily Activity</div>
          <div className="mt-2 font-mono">Risk-Free Rate: 7.0% (India 10Y Bond)</div>
        </CardContent>
      </Card>
    </div>
  );
}
