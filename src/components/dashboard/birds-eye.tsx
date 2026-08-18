'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Globe, Clock, TrendingUp, TrendingDown, Minus,
  AlertTriangle, Newspaper, ArrowUpRight, ArrowDownRight,
} from 'lucide-react';
import type { GlobalIndex, GIFTNifty, NextMonthFutures, ExpiryInfo, NewsEvent } from '@/lib/types';
import {
  generateDemoGlobalIndices,
  generateDemoGIFTNifty,
  generateDemoNextMonthFutures,
  generateDemoExpiryInfo,
  generateDemoNews,
  formatNum,
} from '@/lib/demo-data';

export default function BirdsEye() {
  const [globalIndices, setGlobalIndices] = useState<GlobalIndex[]>([]);
  const [giftNifty, setGiftNifty] = useState<GIFTNifty | null>(null);
  const [nextMonthFut, setNextMonthFut] = useState<NextMonthFutures | null>(null);
  const [expiryInfo, setExpiryInfo] = useState<ExpiryInfo[]>([]);
  const [news, setNews] = useState<NewsEvent[]>([]);
  const [istTime, setIstTime] = useState('');

  useEffect(() => {
    function refresh() {
      setGlobalIndices(generateDemoGlobalIndices());
      setGiftNifty(generateDemoGIFTNifty());
      setNextMonthFut(generateDemoNextMonthFutures());
      setExpiryInfo(generateDemoExpiryInfo());
      setNews(generateDemoNews());

      const now = new Date();
      const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
      setIstTime(ist.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' }));
    }
    refresh();
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, []);

  const impactColor = (impact: GlobalIndex['impactOnNifty']) => {
    switch (impact) {
      case 'positive': return 'text-emerald-400';
      case 'negative': return 'text-red-400';
      case 'mild_positive': return 'text-emerald-400/70';
      case 'mild_negative': return 'text-red-400/70';
      case 'mixed': return 'text-yellow-400';
    }
  };

  const impactLabel = (impact: GlobalIndex['impactOnNifty']) => {
    switch (impact) {
      case 'positive': return 'Positive';
      case 'negative': return 'Negative';
      case 'mild_positive': return 'Mild +';
      case 'mild_negative': return 'Mild −';
      case 'mixed': return 'Mixed';
    }
  };

  const sentimentColor = (s: string) => {
    if (s === 'bullish') return 'text-emerald-400';
    if (s === 'bearish') return 'text-red-400';
    return 'text-yellow-400';
  };

  const categoryBadge = (cat: NewsEvent['category']) => {
    const colors: Record<string, string> = {
      geopolitical: 'bg-red-500/20 text-red-300 border-red-500/30',
      government_data: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
      policy: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
      corporate: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
      global: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    };
    return colors[cat] || 'bg-gray-500/20 text-gray-300 border-gray-500/30';
  };

  return (
    <div className="space-y-4">
      {/* Section A: Global Indices */}
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="h-4 w-4 text-blue-400" />
            Global Indices — Affecting Nifty50
            <Badge variant="outline" className="ml-auto text-xs text-muted-foreground">
              <Clock className="mr-1 h-3 w-3" />IST {istTime}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/40 text-muted-foreground">
                  <th className="py-2 pr-3 text-left font-medium">Index</th>
                  <th className="py-2 pr-3 text-right font-medium">Last</th>
                  <th className="py-2 pr-3 text-right font-medium">Chg</th>
                  <th className="py-2 pr-3 text-right font-medium">Chg%</th>
                  <th className="py-2 pr-3 text-center font-medium">Status</th>
                  <th className="py-2 text-center font-medium">Nifty Impact</th>
                </tr>
              </thead>
              <tbody>
                {globalIndices.map((idx) => (
                  <tr key={idx.name} className="border-b border-border/20 hover:bg-muted/30 transition-colors">
                    <td className="py-1.5 pr-3 font-medium">
                      {idx.name}
                      <span className="ml-1 text-muted-foreground">({idx.country})</span>
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono">{idx.value.toLocaleString()}</td>
                    <td className={`py-1.5 pr-3 text-right font-mono ${idx.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {idx.change >= 0 ? '+' : ''}{idx.change.toLocaleString()}
                    </td>
                    <td className={`py-1.5 pr-3 text-right font-mono ${idx.changePercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {idx.changePercent >= 0 ? '+' : ''}{idx.changePercent.toFixed(2)}%
                    </td>
                    <td className="py-1.5 pr-3 text-center">
                      <Badge variant="outline" className={`text-[10px] ${
                        idx.status === 'open' ? 'border-emerald-500/40 text-emerald-400' :
                        idx.status === 'pre-market' ? 'border-amber-500/40 text-amber-400' :
                        'border-red-500/40 text-red-300'
                      }`}>
                        {idx.status === 'open' ? '● Open' : idx.status === 'pre-market' ? '◐ Pre' : '○ Closed'}
                      </Badge>
                    </td>
                    <td className={`py-1.5 text-center font-medium ${impactColor(idx.impactOnNifty)}`}>
                      {idx.impactOnNifty === 'positive' || idx.impactOnNifty === 'mild_positive' ?
                        <ArrowUpRight className="inline h-3 w-3 mr-0.5" /> :
                        idx.impactOnNifty === 'negative' || idx.impactOnNifty === 'mild_negative' ?
                        <ArrowDownRight className="inline h-3 w-3 mr-0.5" /> :
                        <Minus className="inline h-3 w-3 mr-0.5" />
                      }
                      {impactLabel(idx.impactOnNifty)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Section B: Pre-Market India */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-amber-400" />
              GIFT Nifty (SGX Nifty)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {giftNifty && (
              <div className="space-y-3">
                <div className="flex items-baseline gap-3">
                  <span className="text-3xl font-mono font-bold">{giftNifty.value.toLocaleString()}</span>
                  <span className={`text-sm font-mono ${giftNifty.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {giftNifty.change >= 0 ? '+' : ''}{giftNifty.change.toFixed(0)}
                  </span>
                </div>
                <div className="text-sm text-muted-foreground">
                  Indicative Nifty Open: <span className="font-mono text-foreground font-medium">{giftNifty.indicativeOpen.toLocaleString()}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-blue-400" />
              Next Month Nifty50 Futures
            </CardTitle>
          </CardHeader>
          <CardContent>
            {nextMonthFut && (
              <div className="space-y-2">
                <div className="flex items-baseline gap-3">
                  <span className="text-3xl font-mono font-bold">{nextMonthFut.ltp.toLocaleString()}</span>
                  <Badge variant="outline" className={nextMonthFut.premiumDiscount === 'premium' ? 'border-emerald-500/40 text-emerald-400' : 'border-red-500/40 text-red-400'}>
                    {nextMonthFut.premiumDiscount === 'premium' ? '↑ Premium' : '↓ Discount'}
                  </Badge>
                </div>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">Basis</span>
                    <div className={`font-mono ${nextMonthFut.basis >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {nextMonthFut.basis >= 0 ? '+' : ''}{nextMonthFut.basis.toFixed(0)}
                    </div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">OI</span>
                    <div className="font-mono">{(nextMonthFut.oi / 1000000).toFixed(1)}M</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Basis</span>
                    <div className="font-mono">{nextMonthFut.basis.toFixed(0)} pts</div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Section C: Expiry Countdown */}
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4 text-orange-400" />
            Expiry Countdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {expiryInfo.map((exp) => (
              <div
                key={exp.symbol}
                className={`p-3 rounded-lg border ${
                  exp.isSmartMoneyWindow
                    ? 'border-orange-500/50 bg-orange-500/10'
                    : 'border-border/40 bg-muted/30'
                }`}
              >
                <div className="font-medium text-sm">{exp.name}</div>
                <div className="text-xs text-muted-foreground mt-1">{exp.nextExpiryDate}</div>
                <div className="flex items-center gap-2 mt-2">
                  <span className={`text-lg font-mono font-bold ${exp.daysToExpiry <= 2 ? 'text-orange-400' : 'text-foreground'}`}>
                    {exp.daysToExpiry}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    day{exp.daysToExpiry !== 1 ? 's' : ''}
                  </span>
                </div>
                {exp.isSmartMoneyWindow && (
                  <Badge className="mt-2 bg-orange-500/20 text-orange-300 border-orange-500/30 text-[10px]">
                    <AlertTriangle className="mr-1 h-3 w-3" />
                    SMART MONEY WINDOW
                  </Badge>
                )}
                <Badge variant="outline" className="mt-1.5 text-[10px]">
                  {exp.expiryType === 'weekly' ? 'Weekly' : 'Monthly'}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Section D: News & Events */}
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Newspaper className="h-4 w-4 text-cyan-400" />
            News &amp; Events
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-72">
            <div className="space-y-2">
              {news.map((n, i) => (
                <div key={i} className="flex items-start gap-3 p-2 rounded-md hover:bg-muted/30 transition-colors">
                  <span className="text-xs text-muted-foreground font-mono whitespace-nowrap mt-0.5">{n.time}</span>
                  <Badge className={`text-[10px] shrink-0 ${categoryBadge(n.category)}`}>
                    {n.category.replace('_', ' ')}
                  </Badge>
                  <span className="text-xs flex-1">{n.headline}</span>
                  <Badge variant="outline" className={`text-[10px] shrink-0 ${
                    n.impact === 'high' ? 'border-red-500/40 text-red-300' :
                    n.impact === 'medium' ? 'border-amber-500/40 text-amber-300' :
                    'border-gray-500/40 text-gray-400'
                  }`}>
                    {n.impact.toUpperCase()}
                  </Badge>
                  <span className={`text-xs font-medium shrink-0 ${sentimentColor(n.sentiment)}`}>
                    {n.sentiment === 'bullish' ? '↑ Bull' : n.sentiment === 'bearish' ? '↓ Bear' : '— Neut'}
                  </span>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
