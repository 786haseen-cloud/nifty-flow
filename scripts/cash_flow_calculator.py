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

This module can be used:
  1. As a standalone script for testing
  2. Imported as a module by the Next.js API routes
  3. Integrated with Kite/Zerodha API for live data
"""

from dataclasses import dataclass, field
from typing import List, Optional
import math
from datetime import datetime, timedelta

# ─── Stock Configuration with Weightages ───
# Top 15 Nifty50 stocks sorted by weight
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


@dataclass
class StockCashFlow:
    """Per-stock cash flow data (from Universal Pine Script)"""
    symbol: str
    name: str
    open_price: float
    close_price: float
    volume: int
    high: float = 0.0
    low: float = 0.0
    prev_close: float = 0.0

    # Computed
    cash_flow: float = 0.0         # (Close - Open) × Volume
    cash_flow_cc: float = 0.0      # (Close - PrevClose) × Volume (alternative)
    money_in: float = 0.0          # Buy value (when CF > 0)
    money_out: float = 0.0         # Sell value (when CF < 0)
    nifty_weight: float = 0.0
    sensex_weight: float = 0.0

    def compute(self, method: str = "close_open"):
        """Calculate cash flow using the Pine Script logic"""
        if method == "close_open":
            # True Cash Flow: (Close - Open) × Volume
            self.cash_flow = (self.close_price - self.open_price) * self.volume
        else:
            # Alternative: (Close - PrevClose) × Volume
            self.cash_flow = (self.close_price - self.prev_close) * self.volume

        # Also compute C-C method
        if self.prev_close > 0:
            self.cash_flow_cc = (self.close_price - self.prev_close) * self.volume

        # Money In / Money Out decomposition
        # When price goes up → money flowing in; when down → money flowing out
        if self.cash_flow >= 0:
            self.money_in = self.cash_flow
            self.money_out = 0.0
        else:
            self.money_in = 0.0
            self.money_out = abs(self.cash_flow)


@dataclass
class WeightedCashFlowBar:
    """One bar for the real-time chart (~4 bars per minute = every 15 seconds)"""
    timestamp: datetime
    # Per-stock weighted cash flows
    stock_flows: dict = field(default_factory=dict)  # symbol → weighted CF
    # Combined
    nifty_weighted_cf: float = 0.0   # Combined weighted CF for Nifty50
    sensex_weighted_cf: float = 0.0  # Combined weighted CF for Sensex
    # Money In/Out
    total_money_in: float = 0.0
    total_money_out: float = 0.0
    net_flow: float = 0.0            # total_money_in - total_money_out
    # Signals
    is_inflow: bool = False
    is_outflow: bool = False


@dataclass
class CashFlowTrend:
    """Combined trend with smoothing and bands (from Pine Script)"""
    current_value: float = 0.0
    smoothed: float = 0.0
    upper_band: float = 0.0
    lower_band: float = 0.0
    is_strong_inflow: bool = False
    is_strong_outflow: bool = False
    is_uptrend: bool = False
    is_downtrend: bool = False
    momentum: float = 0.0
    bearish_divergence: bool = False
    bullish_divergence: bool = False
    signal_strength: float = 0.0  # -100 to +100


class CashFlowEngine:
    """
    Main engine combining both Pine Script logics:
    - Universal: per-stock cash flow calculation
    - Nifty 12: weighted combination and trend
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

    def calculate_stock_cash_flow(self, symbol: str, open_price: float,
                                   close_price: float, volume: int,
                                   high: float = 0.0, low: float = 0.0,
                                   prev_close: float = 0.0) -> StockCashFlow:
        """Calculate cash flow for a single stock (Universal script logic)"""
        stock_info = next((s for s in STOCK_WEIGHTS if s["symbol"] == symbol), None)
        name = stock_info["name"] if stock_info else symbol
        nifty_w = stock_info["nifty_weight"] if stock_info else 0.0
        sensex_w = stock_info["sensex_weight"] if stock_info else 0.0

        cf = StockCashFlow(
            symbol=symbol, name=name,
            open_price=open_price, close_price=close_price,
            volume=volume, high=high, low=low, prev_close=prev_close,
            nifty_weight=nifty_w, sensex_weight=sensex_w,
        )
        cf.compute()
        return cf

    def calculate_combined_bar(self, stock_data: List[StockCashFlow],
                                timestamp: datetime = None) -> WeightedCashFlowBar:
        """
        Calculate combined weighted cash flow bar (Nifty 12 script logic)
        Each stock's impact on the index is as per its weightage.

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
            # Weighted Cash Flow = CashFlow × Weight%
            nifty_weighted = stock.cash_flow * stock.nifty_weight / 100.0
            sensex_weighted = stock.cash_flow * stock.sensex_weight / 100.0

            bar.stock_flows[stock.symbol] = {
                "cash_flow": stock.cash_flow,
                "nifty_weighted": nifty_weighted,
                "sensex_weighted": sensex_weighted,
                "weight": stock.nifty_weight,
                "money_in": stock.money_in,
                "money_out": stock.money_out,
            }

            total_nifty_weighted += nifty_weighted
            total_sensex_weighted += sensex_weighted
            total_money_in += stock.money_in
            total_money_out += stock.money_out

        bar.nifty_weighted_cf = total_nifty_weighted
        bar.sensex_weighted_cf = total_sensex_weighted
        bar.total_money_in = total_money_in
        bar.total_money_out = total_money_out
        bar.net_flow = total_money_in - total_money_out
        bar.is_inflow = bar.net_flow > 0
        bar.is_outflow = bar.net_flow < 0

        # Store in history
        self.history.append(total_nifty_weighted)
        if len(self.history) > 200:
            self.history = self.history[-200:]

        self.bars.append(bar)
        if len(self.bars) > 200:
            self.bars = self.bars[-200:]

        return bar

    def calculate_trend(self) -> CashFlowTrend:
        """
        Calculate trend with smoothing, bands, and signals
        (from both Pine Scripts' smoothing/signaling logic)
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

        # Bands
        trend.upper_band = smoothed + (volatility * self.band_multiplier)
        trend.lower_band = smoothed - (volatility * self.band_multiplier)

        # Signals (from Pine Script logic)
        prev = self.history[-2] if len(self.history) >= 2 else current

        # Strong Inflow: current > upperBand AND current > previous
        trend.is_strong_inflow = current > trend.upper_band and current > prev
        # Strong Outflow: current < lowerBand AND current < previous
        trend.is_strong_outflow = current < trend.lower_band and current < prev

        # Trend direction
        prev_smoothed = sum(self.history[-smooth_len-1:-1]) / smooth_len if len(self.history) > smooth_len else smoothed
        trend.is_uptrend = current > smoothed and smoothed > prev_smoothed
        trend.is_downtrend = current < smoothed and smoothed < prev_smoothed

        # Momentum
        if len(self.history) > self.momentum_period:
            trend.momentum = current - self.history[-self.momentum_period]

        # Signal strength (-100 to +100)
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

        # Bearish: Price making new highs but CF not confirming
        trend.bearish_divergence = price_higher and not cf_higher
        # Bullish: Price making new lows but CF not confirming
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

            cf = engine.calculate_stock_cash_flow(
                stock["symbol"], open_price, close_price, volume,
                prev_close=base
            )
            stock_flows.append(cf)

        bar = engine.calculate_combined_bar(stock_flows, timestamp)
        bars.append(bar)

    trend = engine.calculate_trend()

    return bars, trend, engine


if __name__ == "__main__":
    print("Cash Flow Calculator — Converted from Pine Scripts")
    print("=" * 60)

    bars, trend, engine = generate_demo_data()

    print(f"\nGenerated {len(bars)} bars (4 bars/min × 15 min)")
    print(f"\nLatest Bar:")
    latest = bars[-1]
    print(f"  Nifty Weighted CF: {latest.nifty_weighted_cf:,.0f}")
    print(f"  Sensex Weighted CF: {latest.sensex_weighted_cf:,.0f}")
    print(f"  Total Money In:  {latest.total_money_in:,.0f}")
    print(f"  Total Money Out: {latest.total_money_out:,.0f}")
    print(f"  Net Flow:        {latest.net_flow:,.0f}")
    print(f"  Status: {'INFLOW' if latest.is_inflow else 'OUTFLOW' if latest.is_outflow else 'NEUTRAL'}")

    print(f"\nTrend Analysis:")
    print(f"  Current Value:  {trend.current_value:,.0f}")
    print(f"  Smoothed (SMA): {trend.smoothed:,.0f}")
    print(f"  Upper Band:     {trend.upper_band:,.0f}")
    print(f"  Lower Band:     {trend.lower_band:,.0f}")
    print(f"  Strong Inflow:  {trend.is_strong_inflow}")
    print(f"  Strong Outflow: {trend.is_strong_outflow}")
    print(f"  Uptrend:        {trend.is_uptrend}")
    print(f"  Downtrend:      {trend.is_downtrend}")
    print(f"  Momentum:       {trend.momentum:,.0f}")
    print(f"  Signal Strength: {trend.signal_strength:.0f}")

    print(f"\nPer-Stock Weighted Impact (latest bar):")
    for symbol, data in sorted(latest.stock_flows.items(),
                                key=lambda x: abs(x[1]["nifty_weighted"]),
                                reverse=True):
        print(f"  {symbol:12s} | Nifty: {data['nifty_weighted']:>12,.0f} | "
              f"Sensex: {data['sensex_weighted']:>12,.0f} | "
              f"Weight: {data['weight']:.2f}%")
