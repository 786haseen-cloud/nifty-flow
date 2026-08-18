---
Task ID: 1
Agent: Main
Task: Implement institutional data architecture, money flow bar visualization, and live vs after-market signal engine

Work Log:
- Added InstitutionalDailyData, InstitutionalNetFlows, LiveMoneyFlowInference, InstitutionalRollingWindow, MarketDataContext types to types.ts
- Created money-flow-bars.tsx component with Nifty50 price line + Red/Green/Blue bar visualization (15-sec intervals)
- Added generateDemoWeightedBars, computeCashFlowTrend, generateDemoInstitutionalDailyData, toInstitutionalNetFlows, generateDemoRollingWindow, generateDemoLiveInference, generateDemoMarketDataContext to demo-data.ts
- Updated signal-engine.ts with live vs after-market awareness: during live only money flow inference, after market use actual NSE participant data
- Created institutional-service.ts with full Prisma-based data layer: saveLiveSnapshot, saveInstitutionalData, update3DayFlags, rebuildRollingWindowCache, runAfterMarketCorrelation
- Updated Prisma schema with InstitutionalFlow (full participant breakdown), LiveMoneyFlowSnapshot (15-sec), RollingWindowCache models
- Added Data Awareness card to Big Money tab showing live vs after-market status with FII/PropDesk/Client 3-day trends
- Integrated MoneyFlowBars component into Live Monitor tab
- Build verified: zero errors

Stage Summary:
- Architecture: Keep ALL days, signal engine uses 3-day rolling window (isActive3Day flag)
- Live market: Only money flow visible → signal engine infers FII/PropDesk from flow patterns
- After market (~5:30 PM IST): NSE releases data → correlation run fills in who did what
- Bar visualization: Red=Money Out, Green=Money In, Blue=Net Flow, 4 bars/min (15s intervals)
- Weightage-based: Each stock's flow multiplied by index weight (Nifty vs Sensex weights differ)

---
Task ID: 2
Agent: Main
Task: Convert Pine Scripts to Python and integrate with dashboard

Work Log:
- Read both Pine Scripts from /upload folder: universal.txt and nifty50 12 cash flow trend.txt
- Found existing Python conversion at scripts/cash_flow_calculator.py
- Updated Python engine with corrected 15 stocks (SBIN, M&M, BAJFINANCE, ETERNAL, TITAN replacing HINDUNILVR/SUNPHARMA)
- Added dual exchange tracking (NSE + BSE) to Python engine — same stock different buyers/sellers
- Implemented all 3 Pine Script weighting methods: Standard, Volume Weighted, Range Adjusted
- Implemented exact Pine Script signal logic: isStrongInflow = current > upperBand AND current > previous
- Implemented divergence detection from Universal Pine Script
- Updated demo-data.ts bar generation with Pine Script comments and exact logic
- Tested Python script: generates 60 bars, 15 stocks with weighted impact, dual exchange data
- Build verified: zero errors

Stage Summary:
- Pine Script Universal: Fully converted — Standard/Volume Weighted/Range Adjusted methods, smoothing, bands, divergence
- Pine Script Nifty12→15: Fully converted — 15 stocks with actual Nifty50/Sensex weights, weighted CF = CF × Weight%
- Both NSE+BSE tracked: Same stock has different buyers/sellers on each exchange
- Python engine tested successfully with dual exchange output

---
Task ID: 3
Agent: Main
Task: Restructure dashboard to make LIVE primary, 3-day as prediction compass

Work Log:
- Changed default tab from 'birds-eye' to 'live' — LIVE is the HERO
- Reordered tabs: ⚡ LIVE → Signals → 3-Day Pred → Context → Greeks → Settings
- Created live-alignment.tsx: Shows LIVE direction vs 3-Day prediction with ALIGNED/CONFLICT status
- Added LiveAlignmentIndicator as top hero section in Live Monitor
- Updated Big Money tab: Renamed "3-Day Institutional Flow" → "3-Day Prediction Compass" with "ALIGNMENT CHECK ONLY" badge
- Added warning in 3-day section: "This is PREDICTION only, not action. LIVE tells you where market actually goes."
- Updated footer: "LIVE = PRIMARY — Options OI + Cash Flow + Money Flow drives index direction | 3-Day = Prediction compass"
- Build verified: zero errors

Stage Summary:
- Dashboard priority: LIVE > Signals > 3-Day Prediction > Context
- 3-day data = just a compass: "where should market go?" → alignment check
- LIVE options OI + cash flow = where market ACTUALLY goes → primary decision driver
- Live Alignment shows: ALIGNED = trade with confidence, CONFLICT = wait/reduce size

---
Task ID: 2
Agent: main
Task: Enhanced Options Flow tab with Nifty50 price/score line, futures flow, composite signal

Work Log:
- Added FuturesFlowBar, CompositeSignal, TradeAction types to types.ts
- Added generateDemoFuturesFlowBar, generateDemoFuturesFlowBars, computeCompositeSignal to demo-data.ts
- Completely rewrote options-flow-tab.tsx with 6-layer single-screen layout
- Added FlowChartRow, FourColorBar, ScoreBar sub-components for reusability
- Build verification: npx next build passes with zero errors

Stage Summary:
- 6 stacked charts: Price+Score → Cash → Idx Options → Stk Options → Idx Futures → Stk Futures
- Composite signal with BUY CALL / BUY PUT / WAIT actions and confidence scoring
- Signal markers (green/red triangles) on price chart
- Futures breakdown with basis + OI change
- Practical trading tips framework
