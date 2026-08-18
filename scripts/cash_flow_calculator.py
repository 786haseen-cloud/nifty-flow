#!/usr/bin/env python3
"""
Cash Flow Calculator — Converted from TradingView Pine Scripts
Based on:
  - "Universal Cash Flow Trend" Pine Script (per-stock cash flow)
  - "Nifty 12 Cash Flow Trend" Pine Script (combined weighted cash flow)

Core Logic:
  Cash Flow (per stock) = (Close - Open) × Volume
  Weighted Cash Flow = Cash Flow × Weight%
  Combined Trend = Sum(Weighted CF) / Total Weight

Stocks are weighted by their actual Nifty50/Sensex free-float market cap weightage.
Impact on indices is calculated as per weightage (e.g., HDFCBANK 9.97% of Nifty50).

DUAL EXCHANGE: Same stock tracked on NSE and BSE with different buyers/sellers.
Same Reliance buy/sell in NSE and BSE are different — we must track both.

This module can be used:
  1. As a standalone script for testing
  2. Imported as a module by the Next.js API routes
  3. Integrated with Kite/Zerodha API for live data
"""

from dataclasses import dataclass, field
from typing import List, Optional, Dict, Tuple
import math
from datetime import datetime, timedelta

# ─── Stock Configuration with Weightages ───
# Top 15 Nifty50 stocks sorted by weight (ACTUAL weights from user)
# Nifty50 and Sensex weights DIFFER for the same stock
STOCK_WEIGHTS = [
    {"symbol": "HDFCBANK",  "name": "HDFC Bank",            "nifty_weight": 9.97, "sensex_weight": 12.03, "base_price": 1680},
    {"symbol": "ICICIBANK", "name": "ICICI Bank",           "nifty_weight": 9.09, "sensex_weight": 10.96, "base_price": 1250},
    {"symbol": "RELIANCE",  "name": "Reliance Industries",  "nifty_weight": 7.92, "sensex_weight": 9.56,  "base_price": 2950},
    {"symbol": "BHARTIARTL","name": "Bharti Airtel",       "nifty_weight": 5.55, "sensex_weight": 6.70,  "base_price": 1620},
    {"symbol": "LT",        "name": "Larsen & Toubro",      "nifty_weight": 4.25, "sensex_weight": 5.13,  "base_price": 3600},
    {"symbol": "SBIN",      "name": "State Bank India",     "nifty_weight": 3.95, "sensex_weight": 4.77,  "base_price": 830},
    {"symbol": "INFY",      "name": "Infosys",              "nifty_weight": 3.67, "sensex_weight": 4.43,  "base_price": 1580},
    {"symbol": "AXISBANK",  "name": "Axis Bank",            "nifty_weight": 3.13, "sensex_weight": 3.78,  "base_price": 1170},
    {"symbol": "M&M",       "name": "Mahindra & Mahindra",  "nifty_weight": 2.74, "sensex_weight": 3.30,  "base_price": 2900},
    {"symbol": "BAJFINANCE","name": "Bajaj Finance",        "nifty_weight": 2.61, "sensex_weight": 3.15,  "base_price": 7200},
    {"symbol": "KOTAKBANK", "name": "Kotak Bank",           "nifty_weight": 2.58, "sensex_weight": 3.11,  "base_price": 1800},
    {"symbol": "ITC",       "name": "ITC Limited",          "nifty_weight": 2.40, "sensex_weight": 2.90,  "base_price": 470},
    {"symbol": "TCS",       "name": "Tata Consultancy",     "nifty_weight": 2.16, "sensex_weight": 2.60,  "base_price": 3900},
    {"symbol": "ETERNAL",   "name": "Eternal Ltd",          "nifty_weight": 2.06, "sensex_weight": 2.49,  "base_price": 280},
    {"symbol": "TITAN",     "name": "Titan Company",        "nifty_weight": 1.87, "sensex_weight": 2.25,  "base_price": 3550},
]

# Total weights for normalization
TOTAL_NIFTY_WEIGHT = sum(s["nifty_weight"] for s in STOCK_WEIGHTS)   # ~62.97%
TOTAL_SENSEX_WEIGHT = sum(s["sensex_weight"] for s in STOCK_WEIGHTS)  # ~76.17%


@dataclass
class ExchangeStockData:
    """Per-exchange stock data — NSE and BSE have different buyers/sellers"""
    symbol: str
    exchange: str          # 'NSE' or 'BSE'
    open_price: float
    close_price: float
    high: float
    low: float
    volume: int
    buy_volume: int = 0   # Volume at bid (buyers)
    sell_volume: int = 0  # Volume at ask (sellers)
    vwap: float = 0.0     # Volume Weighted Average Price

    # Computed
    cash_flow: float = 0.0
    money_in: float = 0.0
    money_out: float = 0.0


@dataclass
class StockCashFlow:
    """Per-stock cash flow data — combines NSE + BSE (from Universal Pine Script)"""
    symbol: str
    name: str
    # NSE data
    nse: Optional[ExchangeStockData] = None
    # BSE data
    bse: Optional[ExchangeStockData] = None

    # Combined (NSE + BSE)
    open_price: float = 0.0   # Weighted by volume
    close_price: float = 0.0
    volume: int = 0
    high: float = 0.0
    low: float = 0.0
    prev_close: float = 0.0

    # Computed
    cash_flow: float = 0.0         # (Close - Open) × Volume  [Pine Script core]
    cash_flow_cc: float = 0.0      # (Close - PrevClose) × Volume (alternative)
    money_in: float = 0.0          # Total buy value across NSE + BSE
    money_out: float = 0.0         # Total sell value across NSE + BSE
    net_money_flow: float = 0.0    # money_in - money_out
    nifty_weight: float = 0.0
    sensex_weight: float = 0.0

    # Dual exchange specific
    nse_bse_diff: float = 0.0      # NSE price - BSE price (arbitrage opportunity)
    dominant_exchange: str = 'both'  # Which has more volume

    # Weighted cash flows
    nifty_weighted_cf: float = 0.0  # cash_flow × nifty_weight / 100
    sensex_weighted_cf: float = 0.0  # cash_flow × sensex_weight / 100

    def compute(self, method: str = "close_open", weighting_method: str = "Standard",
                custom_multiplier: float = 1.0, sma_volume: float = 0.0,
                sma_range: float = 0.0):
        """
        Calculate cash flow using the Pine Script logic from Universal script.

        Methods from Pine Script:
        - Standard: cashFlow = (Close - Open) × Volume
        - Volume Weighted: cashFlow × (Volume / SMA_Volume)
        - Range Adjusted: cashFlow × (1 + (High-Low) / SMA_Range)

        Then apply manual multiplier.
        """
        # Combine NSE + BSE data
        if self.nse and self.bse:
            total_vol = self.nse.volume + self.bse.volume
            if total_vol > 0:
                # VWAP-weighted combined price
                nse_w = self.nse.volume / total_vol
                bse_w = self.bse.volume / total_vol
                self.open_price = self.nse.open_price * nse_w + self.bse.open_price * bse_w
                self.close_price = self.nse.close_price * nse_w + self.bse.close_price * bse_w
                self.high = max(self.nse.high, self.bse.high)
                self.low = min(self.nse.low, self.bse.low)
            self.volume = self.nse.volume + self.bse.volume
            self.nse_bse_diff = self.nse.close_price - self.bse.close_price
            self.dominant_exchange = (
                'NSE' if self.nse.volume > self.bse.volume * 3 else
                'BSE' if self.bse.volume > self.nse.volume * 3 else 'both'
            )
        elif self.nse:
            self.open_price = self.nse.open_price
            self.close_price = self.nse.close_price
            self.high = self.nse.high
            self.low = self.nse.low
            self.volume = self.nse.volume
        elif self.bse:
            self.open_price = self.bse.open_price
            self.close_price = self.bse.close_price
            self.high = self.bse.high
            self.low = self.bse.low
            self.volume = self.bse.volume

        # Step 1: Raw cash flow (Pine Script core)
        if method == "close_open":
            # True Cash Flow: (Close - Open) × Volume
            self.cash_flow = (self.close_price - self.open_price) * self.volume
        else:
            # Alternative: (Close - PrevClose) × Volume
            self.cash_flow = (self.close_price - self.prev_close) * self.volume

        # Also compute C-C method
        if self.prev_close > 0:
            self.cash_flow_cc = (self.close_price - self.prev_close) * self.volume

        # Step 2: Apply weighting method (from Universal Pine Script)
        if weighting_method == "Volume Weighted" and sma_volume > 0:
            self.cash_flow *= (self.volume / sma_volume)
        elif weighting_method == "Range Adjusted" and sma_range > 0:
            range_val = self.high - self.low
            self.cash_flow *= (1 + range_val / sma_range)

        # Step 3: Apply manual multiplier
        self.cash_flow *= custom_multiplier

        # Step 4: Money In / Money Out decomposition
        if self.cash_flow >= 0:
            self.money_in = self.cash_flow
            self.money_out = 0.0
        else:
            self.money_in = 0.0
            self.money_out = abs(self.cash_flow)

        # Add NSE/BSE specific money in/out
        if self.nse:
            self.money_in += self.nse.money_in
            self.money_out += self.nse.money_out
        if self.bse:
            self.money_in += self.bse.money_in
            self.money_out += self.bse.money_out

        self.net_money_flow = self.money_in - self.money_out

        # Step 5: Weighted cash flows for index impact
        self.nifty_weighted_cf = self.cash_flow * self.nifty_weight / 100.0
        self.sensex_weighted_cf = self.cash_flow * self.sensex_weight / 100.0


@dataclass
class WeightedCashFlowBar:
    """One bar for the real-time chart (~4 bars per minute = every 15 seconds)"""
    timestamp: datetime
    # Per-stock weighted cash flows
    stock_flows: dict = field(default_factory=dict)  # symbol → {cash_flow, nifty_weighted, ...}
    # Combined
    nifty_weighted_cf: float = 0.0   # Combined weighted CF for Nifty50
    sensex_weighted_cf: float = 0.0  # Combined weighted CF for Sensex
    # Money In/Out
    total_money_in: float = 0.0      # Green bar
    total_money_out: float = 0.0     # Red bar
    net_flow: float = 0.0            # Blue bar (Money In - Money Out)
    # Signals
    is_strong_inflow: bool = False
    is_strong_outflow: bool = False


@dataclass
class CashFlowTrend:
    """Combined trend with smoothing and bands (from Pine Script)"""
    current_value: float = 0.0
    smoothed: float = 0.0           # SMA(14)
    upper_band: float = 0.0        # smoothed + 0.5 × stdev
    lower_band: float = 0.0        # smoothed - 0.5 × stdev
    is_strong_inflow: bool = False
    is_strong_outflow: bool = False
    is_uptrend: bool = False
    is_downtrend: bool = False
    momentum: float = 0.0
    is_momentum_up: bool = False
    is_momentum_down: bool = False
    bearish_divergence: bool = False
    bullish_divergence: bool = False
    signal_strength: float = 0.0  # -100 to +100


class CashFlowEngine:
    """
    Main engine combining both Pine Script logics:
    - Universal: per-stock cash flow calculation with Volume Weighted & Range Adjusted
    - Nifty 12 → 15: weighted combination and trend

    Key insight from trader:
    - Live market: Only MONEY FLOW visible, not WHO is behind it
    - Retailers can't move the market in minutes — only institutions can
    - After ~5:30 PM IST: NSE releases FII/DII/PropDesk/Client data
    """

    def __init__(self, smooth_length: int = 14, band_multiplier: float = 0.5,
                 momentum_period: int = 5, divergence_lookback: int = 20):
        self.smooth_length = smooth_length
        self.band_multiplier = band_multiplier
        self.momentum_period = momentum_period
        self.divergence_lookback = divergence_lookback

        # History buffers for smoothing/bands
        self.history: List[float] = []
        self.bars: List[WeightedCashFlowBar] = []

        # SMA buffers for Volume Weighted and Range Adjusted methods
        self.volume_sma: Dict[str, List[float]] = {}  # symbol → recent volumes
        self.range_sma: Dict[str, List[float]] = {}   # symbol → recent ranges

    def _update_sma_buffers(self, symbol: str, volume: float, price_range: float, period: int = 20):
        """Update SMA buffers for Volume Weighted and Range Adjusted methods"""
        if symbol not in self.volume_sma:
            self.volume_sma[symbol] = []
            self.range_sma[symbol] = []

        self.volume_sma[symbol].append(volume)
        self.range_sma[symbol].append(price_range)

        if len(self.volume_sma[symbol]) > period:
            self.volume_sma[symbol] = self.volume_sma[symbol][-period:]
        if len(self.range_sma[symbol]) > period:
            self.range_sma[symbol] = self.range_sma[symbol][-period:]

    def get_sma_volume(self, symbol: str) -> float:
        """Get SMA of volume for Volume Weighted method"""
        vols = self.volume_sma.get(symbol, [])
        return sum(vols) / len(vols) if vols else 0.0

    def get_sma_range(self, symbol: str) -> float:
        """Get SMA of range for Range Adjusted method"""
        ranges = self.range_sma.get(symbol, [])
        return sum(ranges) / len(ranges) if ranges else 0.0

    def calculate_stock_cash_flow(self, symbol: str, open_price: float,
                                   close_price: float, volume: int,
                                   high: float = 0.0, low: float = 0.0,
                                   prev_close: float = 0.0,
                                   nse_data: ExchangeStockData = None,
                                   bse_data: ExchangeStockData = None,
                                   method: str = "close_open",
                                   weighting_method: str = "Standard",
                                   custom_multiplier: float = 1.0
                                   ) -> StockCashFlow:
        """
        Calculate cash flow for a single stock (Universal script logic)
        Supports all 3 weighting methods from Pine Script.
        """
        stock_info = next((s for s in STOCK_WEIGHTS if s["symbol"] == symbol), None)
        name = stock_info["name"] if stock_info else symbol
        nifty_w = stock_info["nifty_weight"] if stock_info else 0.0
        sensex_w = stock_info["sensex_weight"] if stock_info else 0.0

        # Update SMA buffers for weighting methods
        price_range = (high - low) if high > 0 and low > 0 else abs(close_price - open_price)
        self._update_sma_buffers(symbol, volume, price_range)

        cf = StockCashFlow(
            symbol=symbol, name=name,
            nse=nse_data, bse=bse_data,
            open_price=open_price, close_price=close_price,
            volume=volume, high=high, low=low, prev_close=prev_close,
            nifty_weight=nifty_w, sensex_weight=sensex_w,
        )

        # Get SMA values for weighting methods
        sma_vol = self.get_sma_volume(symbol)
        sma_rng = self.get_sma_range(symbol)

        cf.compute(
            method=method,
            weighting_method=weighting_method,
            custom_multiplier=custom_multiplier,
            sma_volume=sma_vol,
            sma_range=sma_rng,
        )
        return cf

    def calculate_combined_bar(self, stock_data: List[StockCashFlow],
                                timestamp: datetime = None) -> WeightedCashFlowBar:
        """
        Calculate combined weighted cash flow bar (Nifty 15 script logic)
        Each stock's impact on the index is as per its weightage.

        Pine Script logic:
          weightedCF = cashFlow × weight%
          totalWeightedCF = sum of all weightedCF
          trend = totalWeightedCF / totalWeight
        """
        if timestamp is None:
            timestamp = datetime.now()

        bar = WeightedCashFlowBar(timestamp=timestamp)

        total_nifty_weighted = 0.0
        total_sensex_weighted = 0.0
        total_money_in = 0.0
        total_money_out = 0.0

        for stock in stock_data:
            bar.stock_flows[stock.symbol] = {
                "cash_flow": stock.cash_flow,
                "nifty_weighted": stock.nifty_weighted_cf,
                "sensex_weighted": stock.sensex_weighted_cf,
                "weight": stock.nifty_weight,
                "sensex_weight": stock.sensex_weight,
                "money_in": stock.money_in,
                "money_out": stock.money_out,
                "net_flow": stock.net_money_flow,
                # Dual exchange info
                "nse_bse_diff": stock.nse_bse_diff,
                "dominant_exchange": stock.dominant_exchange,
            }

            total_nifty_weighted += stock.nifty_weighted_cf
            total_sensex_weighted += stock.sensex_weighted_cf
            total_money_in += stock.money_in
            total_money_out += stock.money_out

        bar.nifty_weighted_cf = total_nifty_weighted
        bar.sensex_weighted_cf = total_sensex_weighted
        bar.total_money_in = total_money_in
        bar.total_money_out = total_money_out
        bar.net_flow = total_money_in - total_money_out

        # Store in history for trend calculation
        self.history.append(total_nifty_weighted)
        if len(self.history) > 500:
            self.history = self.history[-500:]

        self.bars.append(bar)
        if len(self.bars) > 500:
            self.bars = self.bars[-500:]

        return bar

    def calculate_trend(self) -> CashFlowTrend:
        """
        Calculate trend with smoothing, bands, and signals
        (from both Pine Scripts' smoothing/signaling logic)

        Pine Script logic:
          cfSmooth = ta.sma(cashFlowFinal, smoothLength)
          cfVolatility = ta.stdev(cashFlowFinal, smoothLength)
          upperBand = cfSmooth + (cfVolatility * bandMultiplier)
          lowerBand = cfSmooth - (cfVolatility * bandMultiplier)
          isStrongInflow = cashFlowFinal > upperBand AND cashFlowFinal > cashFlowFinal[1]
          isStrongOutflow = cashFlowFinal < lowerBand AND cashFlowFinal < cashFlowFinal[1]
        """
        trend = CashFlowTrend()

        if len(self.history) < 2:
            return trend

        current = self.history[-1]
        trend.current_value = current

        # Smoothing: SMA over smooth_length
        smooth_len = min(self.smooth_length, len(self.history))
        smoothed = sum(self.history[-smooth_len:]) / smooth_len
        trend.smoothed = smoothed

        # Volatility: Standard deviation
        if smooth_len > 1:
            variance = sum((x - smoothed) ** 2 for x in self.history[-smooth_len:]) / smooth_len
            volatility = math.sqrt(variance)
        else:
            volatility = 0.0

        # Bands (Pine Script exact logic)
        trend.upper_band = smoothed + (volatility * self.band_multiplier)
        trend.lower_band = smoothed - (volatility * self.band_multiplier)

        # Signals (Pine Script exact logic)
        prev = self.history[-2] if len(self.history) >= 2 else current

        # Strong Inflow: current > upperBand AND current > previous (accelerating)
        trend.is_strong_inflow = current > trend.upper_band and current > prev
        # Strong Outflow: current < lowerBand AND current < previous (accelerating)
        trend.is_strong_outflow = current < trend.lower_band and current < prev

        # Trend direction (Pine Script logic)
        prev_smoothed = (sum(self.history[-smooth_len-1:-1]) / smooth_len
                        if len(self.history) > smooth_len else smoothed)
        trend.is_uptrend = current > smoothed and smoothed > prev_smoothed
        trend.is_downtrend = current < smoothed and smoothed < prev_smoothed

        # Momentum (Pine Script logic)
        if len(self.history) > self.momentum_period:
            trend.momentum = current - self.history[-self.momentum_period]
            prev_momentum = self.history[-self.momentum_period] - self.history[-self.momentum_period * 2] if len(self.history) > self.momentum_period * 2 else 0
            trend.is_momentum_up = trend.momentum > 0 and trend.momentum > prev_momentum
            trend.is_momentum_down = trend.momentum < 0 and trend.momentum < prev_momentum

        # Signal strength (-100 to +100) (Pine Script exact logic)
        if trend.is_strong_inflow:
            trend.signal_strength = 100
        elif trend.is_strong_outflow:
            trend.signal_strength = -100
        elif current > trend.upper_band:
            trend.signal_strength = 75
        elif current < trend.lower_band:
            trend.signal_strength = -75
        elif current > 0:
            trend.signal_strength = 25
        elif current < 0:
            trend.signal_strength = -25

        return trend

    def detect_divergence(self, prices: List[float]) -> CashFlowTrend:
        """
        Detect divergence between price and cash flow
        (from Universal Pine Script divergence logic)

        Pine Script logic:
          bearishDivergence = priceHigher and cfHigher == false
          bullishDivergence = priceLower and cfLower == false
        """
        trend = self.calculate_trend()

        lookback = min(self.divergence_lookback, len(prices), len(self.history))
        if lookback < 2:
            return trend

        recent_prices = prices[-lookback:]
        recent_cf = self.history[-lookback:]

        highest_price = max(recent_prices)
        lowest_price = min(recent_prices)
        highest_cf = max(recent_cf)
        lowest_cf = min(recent_cf)

        prev_prices = prices[-lookback-1:-1] if len(prices) > lookback else recent_prices
        prev_cf = self.history[-lookback-1:-1] if len(self.history) > lookback else recent_cf

        highest_price_prev = max(prev_prices) if prev_prices else highest_price
        lowest_price_prev = min(prev_prices) if prev_prices else lowest_price
        highest_cf_prev = max(prev_cf) if prev_cf else highest_cf
        lowest_cf_prev = min(prev_cf) if prev_cf else lowest_cf

        price_higher = highest_price > highest_price_prev
        cf_higher = highest_cf > highest_cf_prev
        price_lower = lowest_price < lowest_price_prev
        cf_lower = lowest_cf < lowest_cf_prev

        # Bearish: Price making new highs but CF NOT confirming
        trend.bearish_divergence = price_higher and not cf_higher
        # Bullish: Price making new lows but CF NOT confirming
        trend.bullish_divergence = price_lower and not cf_lower

        return trend


# ─── Demo / Testing ───
def generate_demo_data():
    """Generate demo data for testing (simulates Kite API data)"""
    import random

    engine = CashFlowEngine()
    bars = []

    # Generate 60 bars (15 minutes of data at 4 bars/min)
    for i in range(60):
        timestamp = datetime.now() - timedelta(seconds=(60 - i) * 15)

        stock_flows = []
        for stock in STOCK_WEIGHTS:
            base = stock["base_price"]
            open_price = base + random.uniform(-base * 0.005, base * 0.005)
            close_price = open_price + random.uniform(-base * 0.01, base * 0.01)
            volume = int(random.uniform(100000, 5000000))

            # Create NSE + BSE data (dual exchange)
            nse = ExchangeStockData(
                symbol=stock["symbol"], exchange="NSE",
                open_price=open_price,
                close_price=close_price + random.uniform(-1, 1),
                high=close_price + random.uniform(0, 5),
                low=open_price - random.uniform(0, 5),
                volume=volume,
                buy_volume=int(volume * random.uniform(0.4, 0.6)),
                sell_volume=int(volume * random.uniform(0.4, 0.6)),
            )
            bse = ExchangeStockData(
                symbol=stock["symbol"], exchange="BSE",
                open_price=open_price + random.uniform(-2, 0),
                close_price=close_price + random.uniform(-3, 1),  # BSE often slightly lower
                high=close_price + random.uniform(0, 4),
                low=open_price - random.uniform(0, 6),
                volume=int(volume * random.uniform(0.05, 0.3)),  # BSE has much less volume
                buy_volume=int(volume * random.uniform(0.02, 0.15)),
                sell_volume=int(volume * random.uniform(0.02, 0.15)),
            )

            cf = engine.calculate_stock_cash_flow(
                stock["symbol"], open_price, close_price, volume,
                high=max(nse.high, bse.high), low=min(nse.low, bse.low),
                prev_close=base,
                nse_data=nse, bse_data=bse,
                method="close_open", weighting_method="Standard",
            )
            stock_flows.append(cf)

        bar = engine.calculate_combined_bar(stock_flows, timestamp)
        bars.append(bar)

    trend = engine.calculate_trend()

    return bars, trend, engine


if __name__ == "__main__":
    print("Cash Flow Calculator — Converted from Pine Scripts")
    print("=" * 60)
    print(f"\nStocks: {len(STOCK_WEIGHTS)} (Top 15 Nifty50 by weight)")
    print(f"Total Nifty Weight Coverage: {TOTAL_NIFTY_WEIGHT:.2f}%")
    print(f"Total Sensex Weight Coverage: {TOTAL_SENSEX_WEIGHT:.2f}%")

    bars, trend, engine = generate_demo_data()

    print(f"\nGenerated {len(bars)} bars (4 bars/min × 15 min)")
    print(f"\nLatest Bar:")
    latest = bars[-1]
    print(f"  Nifty Weighted CF:  {latest.nifty_weighted_cf:>15,.0f}")
    print(f"  Sensex Weighted CF: {latest.sensex_weighted_cf:>15,.0f}")
    print(f"  Total Money In:     {latest.total_money_in:>15,.0f}  (Green bar)")
    print(f"  Total Money Out:    {latest.total_money_out:>15,.0f}  (Red bar)")
    print(f"  Net Flow:           {latest.net_flow:>15,.0f}  (Blue bar)")
    print(f"  Status: {'STRONG INFLOW' if latest.is_strong_inflow else 'STRONG OUTFLOW' if latest.is_strong_outflow else 'INFLOW' if latest.net_flow > 0 else 'OUTFLOW'}")

    print(f"\nTrend Analysis (Pine Script Logic):")
    print(f"  Current Value:  {trend.current_value:>15,.0f}")
    print(f"  Smoothed (SMA): {trend.smoothed:>15,.0f}")
    print(f"  Upper Band:     {trend.upper_band:>15,.0f}")
    print(f"  Lower Band:     {trend.lower_band:>15,.0f}")
    print(f"  Strong Inflow:  {trend.is_strong_inflow}")
    print(f"  Strong Outflow: {trend.is_strong_outflow}")
    print(f"  Uptrend:        {trend.is_uptrend}")
    print(f"  Downtrend:      {trend.is_downtrend}")
    print(f"  Momentum:       {trend.momentum:>15,.0f}  {'ACCELERATING' if trend.is_momentum_up else 'DECELERATING' if trend.is_momentum_down else 'NEUTRAL'}")
    print(f"  Signal Strength: {trend.signal_strength:.0f}")

    print(f"\nPer-Stock Weighted Impact (latest bar) — Dual Exchange:")
    print(f"  {'Symbol':12s} | {'Nifty Wt CF':>14s} | {'Sensex Wt CF':>14s} | {'NSE-BSE':>8s} | {'Dominant':>8s} | {'Weight':>7s}")
    print(f"  {'-'*12} | {'-'*14} | {'-'*14} | {'-'*8} | {'-'*8} | {'-'*7}")
    for symbol, data in sorted(latest.stock_flows.items(),
                                key=lambda x: abs(x[1]["nifty_weighted"]),
                                reverse=True):
        nse_bse = data.get('nse_bse_diff', 0)
        dom = data.get('dominant_exchange', 'both')
        print(f"  {symbol:12s} | {data['nifty_weighted']:>14,.0f} | {data['sensex_weighted']:>14,.0f} | {nse_bse:>+8.1f} | {dom:>8s} | {data['weight']:>6.2f}%")
