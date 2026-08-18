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
