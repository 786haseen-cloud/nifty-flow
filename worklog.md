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
