---
Task ID: cas-netmoney-dualexchange
Agent: Main Agent
Task: Fix CAS rules (F&O continues during CAS), add Net Money Flow, add dual exchange (NSE+BSE) tracking

Work Log:
- Updated NSESessionInfo type: added isCashActive field (false during CAS, true during CTS)
- Rewrote nse-sessions.ts: All CAS sessions now show isCashActive=false, isDerivativesOpen=true
- Session labels clearly show "⛔ CASH PAUSED | ✅ F&O ACTIVE" during CAS
- Added NetMoneyFlow interface: moneyIn, moneyOut, netFlow, intensity
- Added ExchangeStockData interface: per-exchange data (NSE/BSE) with buy/sell volumes, VWAP
- Added DualExchangeStock interface: combines NSE+BSE data, shows nseBseDiff (arbitrage), dominantExchange
- Updated demo-data.ts: generateDemoStocks now includes netMoneyFlow + nseLTP/bseLTP/nseBseDiff
- Added generateDemoNetMoneyFlow() and generateDemoDualExchangeStocks() generators
- Updated birds-eye.tsx: Cash/F&O status shown separately (Cash: ● Active / ⛔ PAUSED, F&O: ✅ Active)
- Session timings table now has Cash and F&O columns with color-coded status
- CAS alert now says "Cash PAUSED, but Options & Futures CONTINUE trading!"
- Key CAS rules grid now highlights F&O continues and Cash paused separately
- Updated live-monitor.tsx: Top 15 stocks now shows full Net Money Flow table with NSE, BSE, Diff, Money In, Money Out, Net Flow, Intensity columns
- Updated big-money-tab.tsx: Added Net Money Flow summary card with total Money In/Out/Net across all 15 stocks + per-stock NSE vs BSE breakdown
- Updated page.tsx header: During CAS shows "⛔ CAS — F&O Active" with separate Cash PAUSED and F&O Active badges
- Build verified: npx next build compiled successfully with zero errors

Stage Summary:
- CAS correction: Options & Futures CONTINUE during CAS (3:15-3:35 PM), only CASH stops
- Net Money Flow: Money In - Money Out calculation for heavy weight stocks
- Dual Exchange: Same stock tracked on both NSE and BSE (different buyers/sellers)
- All 3 corrections fully implemented across types, sessions, demo data, and all relevant tabs
---
Task ID: weightage-pinescript-cashflow
Agent: Main Agent
Task: Add stock weightages for Nifty50/Sensex, convert Pine Scripts to Python, create weighted cash flow bar chart

Work Log:
- Updated TOP_STOCKS with correct weightages for both Nifty50 and Sensex
  - Replaced HINDUNILVR with M&M (Mahindra & Mahindra), 2.74%/3.30%
  - Replaced MARUTI with ETERNAL (Eternal Ltd), 2.06%/2.49%
  - Sorted by Nifty50 weight: HDFCBANK 9.97%, ICICIBANK 9.09%, RELIANCE 7.92%, etc.
- Read and analyzed both Pine Scripts:
  - Universal: per-stock cash flow = (Close-Open) × Volume, with smoothing/bands/divergence
  - Nifty 12: weighted combination = cashFlow × weight%, combined trend
- Converted Pine Scripts to Python: scripts/cash_flow_calculator.py
  - CashFlowEngine class with calculate_stock_cash_flow, calculate_combined_bar, calculate_trend, detect_divergence
  - Weighted Cash Flow = CashFlow × Weight% per stock
  - Combined = Sum of all weighted CFs
  - Smoothing: SMA(14), Bands: ±0.5×StDev, Inflow/Outflow signals
  - Tested successfully with demo data
- Added WeightedCashFlowBar and CashFlowTrend types to types.ts
- Added generateDemoWeightedCashFlowBars() and generateDemoCashFlowTrend() to demo-data.ts
  - 4 bars per minute (every 15 seconds) as user requested
  - Each bar = CashFlow = (Close-Open) × Volume × Weight%
- Created WeightedCashFlowChart component (weighted-cash-flow.tsx)
  - Green bars = Money In
  - Red bars = Money Out (shown as negative)
  - Blue line = Net Flow overlaid
  - Summary cards: Nifty Weighted CF, Total Money In/Out, Net Flow
  - Trend analysis: Current, SMA(14), Upper/Lower Bands, Inflow/Outflow, Momentum, Divergence
  - Per-stock weightage impact breakdown table
- Integrated into Big Money tab (below all other sections)
- Updated STOCK_BASE_PRICES in demo-data.ts with correct weights
- Build verified: npx next build compiled successfully with zero errors

Stage Summary:
- Stock weightages: Nifty50 and Sensex specific (e.g., HDFCBANK 9.97%/12.03%)
- Pine Scripts converted to Python (cash_flow_calculator.py) and TypeScript (demo-data generators)
- Weighted cash flow bar chart: Green=In, Red=Out, Blue=Net, 4 bars/min
- Impact on indices calculated as per weightage (HDFCBANK 9.97% impacts Nifty 4× more than ITC 2.40%)
