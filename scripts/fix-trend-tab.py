#!/usr/bin/env python3
"""Apply all stock flow fixes to trend-analysis-tab.tsx atomically."""
import re

path = '/home/z/my-project/src/components/dashboard/trend-analysis-tab.tsx'
with open(path, 'r') as f:
    content = f.read()

# 1. Remove AreaChart, Area from imports
content = content.replace(
    '  LineChart, Line, AreaChart, Area, BarChart, Bar,\n',
    '  LineChart, Line, BarChart, Bar,\n'
)

# 2. Fix FlowTooltip - add friendlyName
content = content.replace(
    'function FlowTooltip({ active, payload, label }: any) {\n  if (!active || !payload?.length) return null;\n  const labelStr = typeof label === "number" ? minutesToTimeStr(label) : String(label ?? "");\n  return (\n    <div className="bg-card border border-border rounded-lg p-2 shadow-xl text-xs">\n      <div className="font-mono text-muted-foreground mb-1">{labelStr}</div>\n      {payload.map((p: any) => (\n        <div key={p.dataKey} style={{ color: p.color }} className="flex items-center gap-1">\n          <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />\n          {p.dataKey}: {typeof p.value === "number" ? p.value.toFixed(1) : p.value} Cr\n        </div>\n      ))}\n    </div>\n  );\n}',
    'function FlowTooltip({ active, payload, label }: any) {\n  if (!active || !payload?.length) return null;\n  const labelStr = typeof label === "number" ? minutesToTimeStr(label) : String(label ?? "");\n  const friendlyName: Record<string, string> = { stockAggregate: "Stock Flow" };\n  return (\n    <div className="bg-card border border-border rounded-lg p-2 shadow-xl text-xs">\n      <div className="font-mono text-muted-foreground mb-1">{labelStr}</div>\n      {payload.map((p: any) => (\n        <div key={p.dataKey} style={{ color: p.color }} className="flex items-center gap-1">\n          <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />\n          {friendlyName[p.dataKey] || p.dataKey}: {typeof p.value === "number" ? p.value.toFixed(1) : p.value} Cr\n        </div>\n      ))}\n    </div>\n  );\n}'
)

# 3. Replace fmtCr with fmtRaw + fmtCr
content = content.replace(
    '  // ─── Format helpers ───\n\n  const fmtCr = (v: number) => {\n    const cr = v / 10000000;\n    if (Math.abs(cr) >= 100) return `${cr.toFixed(0)}`;\n    if (Math.abs(cr) >= 1) return `${cr.toFixed(1)}`;\n    return `${cr.toFixed(2)}`;\n  };',
    '  // ─── Format helpers ───\n  const fmtRaw = (v: number) => {\n    const cr = v / 10000000;\n    if (Math.abs(cr) >= 100) return `${cr.toFixed(0)}`;\n    if (Math.abs(cr) >= 1) return `${cr.toFixed(1)}`;\n    return `${cr.toFixed(2)}`;\n  };\n  const fmtCr = (v: number) => {\n    if (Math.abs(v) >= 100) return `${v.toFixed(0)}`;\n    if (Math.abs(v) >= 1) return `${v.toFixed(1)}`;\n    return `${v.toFixed(2)}`;\n  };'
)

# 4. Fix 15s interval cash flow formatter
content = content.replace(
    '15s: {currentIntervalCashFlow >= 0 ? \'+\' : \'\'}{fmtCr(currentIntervalCashFlow)} Cr',
    '15s: {currentIntervalCashFlow >= 0 ? \'+\' : \'\'}{fmtRaw(currentIntervalCashFlow)} Cr'
)

# 5. Replace the entire Stock Options Money Flow card (AreaChart → LineChart)
old_stock_card = '''        {/* Stock Options Money Flow Trend */}
        <div className="rounded-xl border border-border/50 bg-card/50 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-orange-400" />
              <h3 className="text-sm font-semibold">Stock Options Money Flow (15 F&O Stocks)</h3>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-mono font-semibold ${currentStockFlow >= 0 ? \'text-emerald-400\' : \'text-red-400\'}`}>
                Interval: {currentStockFlow >= 0 ? \'+\' : \'\'}{fmtCr(currentStockFlow)} Cr
              </span>
              <span className="text-[10px] text-muted-foreground">
                Cum: {fmtCr(cumulativeFlow.stockAggregate || 0)} Cr
              </span>
            </div>
          </div>
          <div className="h-[230px]">
            {flowChartData.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={flowChartData} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="stockFlowGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f97316" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#f97316" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                  <XAxis
                    dataKey="x"
                    type="number"
                    domain={flowDomain}
                    ticks={flowTicks}
                    tickFormatter={(v: number) => minutesToTimeStr(v)}
                    tick={{ fill: \'#a1a1aa\', fontSize: 9 }}
                    allowDataOverflow
                  />
                  <YAxis
                    tick={{ fill: \'#a1a1aa\', fontSize: 10 }}
                    tickFormatter={(v: number) => v.toFixed(0)}
                    width={45}
                  />
                  <Tooltip content={<FlowTooltip />} />
                  <ReferenceLine y={0} stroke="#ffffff30" />
                  <Area
                    type="monotone"
                    dataKey="stockAggregate"
                    stroke="#f97316"
                    strokeWidth={2}
                    fill="url(#stockFlowGrad)"
                    dot={false}
                    activeDot={{ r: 4, fill: \'#f97316\', stroke: \'#fff\', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
                Accumulating stock options flow data... (need 2+ snapshots)
              </div>
            )}
          </div>
        </div>'''

new_stock_card = '''        {/* Stock Options Money Flow Trend */}
        <div className="rounded-xl border border-border/50 bg-card/50 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-orange-400" />
              <h3 className="text-sm font-semibold">Stock Options Money Flow (15 F&O Stocks)</h3>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-mono font-semibold ${currentStockFlow >= 0 ? \'text-emerald-400\' : \'text-red-400\'}`}>
                Int: {currentStockFlow >= 0 ? \'+\' : \'\'}{fmtCr(currentStockFlow)} Cr
              </span>
              <span className="text-[10px] text-muted-foreground">
                Cum: {fmtCr(cumulativeFlow.stockAggregate || 0)} Cr
              </span>
            </div>
          </div>
          <div className="h-[230px]">
            {flowChartData.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={flowChartData} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                  <XAxis
                    dataKey="x"
                    type="number"
                    domain={flowDomain}
                    ticks={flowTicks}
                    tickFormatter={(v: number) => minutesToTimeStr(v)}
                    tick={{ fill: \'#a1a1aa\', fontSize: 9 }}
                    allowDataOverflow
                  />
                  <YAxis
                    tick={{ fill: \'#a1a1aa\', fontSize: 10 }}
                    tickFormatter={(v: number) => `${v.toFixed(0)}`}
                    width={55}
                  />
                  <Tooltip content={<FlowTooltip />} />
                  <ReferenceLine y={0} stroke="#ffffff30" />
                  <Line
                    type="monotone"
                    dataKey="stockAggregate"
                    stroke="#f97316"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: \'#f97316\', stroke: \'#fff\', strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
                Accumulating stock options flow data... (need 2+ snapshots)
              </div>
            )}
          </div>
        </div>'''

content = content.replace(old_stock_card, new_stock_card)

# 6. Fix Dual Exchange header formatters (raw rupees → fmtRaw)
content = content.replace('NSE: {fmtCr(totalNseFlow)} Cr', 'NSE: {fmtRaw(totalNseFlow)} Cr')
content = content.replace('BSE: {fmtCr(totalBseFlow)} Cr', 'BSE: {fmtRaw(totalBseFlow)} Cr')
content = content.replace('Net: {fmtCr(totalCombinedFlow)} Cr', 'Net: {fmtRaw(totalCombinedFlow)} Cr')
content = content.replace('Weighted: {fmtCr(totalWeightedFlow)} Cr', 'Weighted: {fmtRaw(totalWeightedFlow)} Cr')

# 7. Fix table cell formatters
content = content.replace('{fmtCr(s.nseCashFlow)}', '{fmtRaw(s.nseCashFlow)} Cr')
content = content.replace('{s.bseLtp > 0 ? fmtCr(s.bseCashFlow) : \'-\'}', "{s.bseLtp > 0 ? `${fmtRaw(s.bseCashFlow)} Cr` : '-'}")
content = content.replace('{fmtCr(s.combinedFlow)}', '{fmtRaw(s.combinedFlow)} Cr')
content = content.replace('{fmtCr(s.weightedFlow)}', '{fmtRaw(s.weightedFlow)} Cr')

with open(path, 'w') as f:
    f.write(content)

print('Done! Applied all fixes.')