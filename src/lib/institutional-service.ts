/**
 * Institutional Data Service
 * 
 * KEY INSIGHT from the trader:
 * - During LIVE MARKET: We only see MONEY FLOW, not WHO is behind it
 * - Retailers can't move the market in minutes — only institutions can
 * - After ~5:30 PM IST: NSE releases participant data (FII, DII, PropDesk, Client)
 * - We CORRELATE after-market data with live money flow patterns
 * 
 * Data Retention Policy:
 * - ALL daily data is stored (for backtesting & pattern discovery)
 * - Signal engine uses 3-day rolling window (configurable)
 * - Live snapshots every 15 seconds during market hours
 * - After-market correlation run once daily after NSE data release
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// =====================================================
// LIVE MARKET: Money Flow Tracking (15-second snapshots)
// =====================================================

export interface MoneyFlowSnapshotInput {
  timestamp: Date;
  totalMoneyIn: number;
  totalMoneyOut: number;
  netFlow: number;
  flowVelocity: number;
  likelyInstitutional: boolean;
  stockFlowsJson?: string;
  niftyWeightedCF: number;
  sensexWeightedCF: number;
}

/**
 * Save a 15-second money flow snapshot during live market
 * This is the ONLY data available during live hours
 */
export async function saveLiveSnapshot(data: MoneyFlowSnapshotInput): Promise<void> {
  const date = data.timestamp.toISOString().split('T')[0];
  
  await prisma.liveMoneyFlowSnapshot.create({
    data: {
      timestamp: data.timestamp,
      date,
      totalMoneyIn: data.totalMoneyIn,
      totalMoneyOut: data.totalMoneyOut,
      netFlow: data.netFlow,
      flowVelocity: data.flowVelocity,
      likelyInstitutional: data.likelyInstitutional,
      stockFlowsJson: data.stockFlowsJson,
      niftyWeightedCF: data.niftyWeightedCF,
      sensexWeightedCF: data.sensexWeightedCF,
    },
  });

  // Cleanup: Keep only last 2 days of live snapshots to prevent DB bloat
  const twoDaysAgo = new Date();
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  await prisma.liveMoneyFlowSnapshot.deleteMany({
    where: {
      timestamp: { lt: twoDaysAgo },
    },
  });
}

/**
 * Get recent live snapshots for the money flow bar chart
 */
export async function getRecentSnapshots(minutes: number = 30) {
  const since = new Date(Date.now() - minutes * 60 * 1000);
  return prisma.liveMoneyFlowSnapshot.findMany({
    where: { timestamp: { gte: since } },
    orderBy: { timestamp: 'asc' },
  });
}

// =====================================================
// AFTER-MARKET: NSE Participant Data
// =====================================================

export interface InstitutionalDataInput {
  date: string;
  fiiCashBuy: number; fiiCashSell: number;
  fiiFutBuy: number; fiiFutSell: number;
  fiiOptCallBuy: number; fiiOptCallSell: number;
  fiiOptPutBuy: number; fiiOptPutSell: number;
  diiCashBuy: number; diiCashSell: number;
  diiFutBuy: number; diiFutSell: number;
  propdeskCashBuy: number; propdeskCashSell: number;
  propdeskFutBuy: number; propdeskFutSell: number;
  propdeskOptCallBuy: number; propdeskOptCallSell: number;
  propdeskOptPutBuy: number; propdeskOptPutSell: number;
  clientCashBuy: number; clientCashSell: number;
  clientFutBuy: number; clientFutSell: number;
  clientOptCallBuy: number; clientOptCallSell: number;
  clientOptPutBuy: number; clientOptPutSell: number;
}

/**
 * Save after-market NSE participant data
 * Called once daily after NSE releases data (~5:30 PM IST)
 */
export async function saveInstitutionalData(data: InstitutionalDataInput): Promise<void> {
  await prisma.institutionalFlow.upsert({
    where: { date: data.date },
    create: {
      date: data.date,
      fiiCashBuy: data.fiiCashBuy,
      fiiCashSell: data.fiiCashSell,
      fiiFutBuy: data.fiiFutBuy,
      fiiFutSell: data.fiiFutSell,
      fiiOptCallBuy: data.fiiOptCallBuy,
      fiiOptCallSell: data.fiiOptCallSell,
      fiiOptPutBuy: data.fiiOptPutBuy,
      fiiOptPutSell: data.fiiOptPutSell,
      diiCashBuy: data.diiCashBuy,
      diiCashSell: data.diiCashSell,
      diiFutBuy: data.diiFutBuy,
      diiFutSell: data.diiFutSell,
      propdeskCashBuy: data.propdeskCashBuy,
      propdeskCashSell: data.propdeskCashSell,
      propdeskFutBuy: data.propdeskFutBuy,
      propdeskFutSell: data.propdeskFutSell,
      propdeskOptCallBuy: data.propdeskOptCallBuy,
      propdeskOptCallSell: data.propdeskOptCallSell,
      propdeskOptPutBuy: data.propdeskOptPutBuy,
      propdeskOptPutSell: data.propdeskOptPutSell,
      clientCashBuy: data.clientCashBuy,
      clientCashSell: data.clientCashSell,
      clientFutBuy: data.clientFutBuy,
      clientFutSell: data.clientFutSell,
      clientOptCallBuy: data.clientOptCallBuy,
      clientOptCallSell: data.clientOptCallSell,
      clientOptPutBuy: data.clientOptPutBuy,
      clientOptPutSell: data.clientOptPutSell,
      dataSource: 'nse_official',
      isActive3Day: true,
    },
    update: {
      fiiCashBuy: data.fiiCashBuy,
      fiiCashSell: data.fiiCashSell,
      fiiFutBuy: data.fiiFutBuy,
      fiiFutSell: data.fiiFutSell,
      fiiOptCallBuy: data.fiiOptCallBuy,
      fiiOptCallSell: data.fiiOptCallSell,
      fiiOptPutBuy: data.fiiOptPutBuy,
      fiiOptPutSell: data.fiiOptPutSell,
      diiCashBuy: data.diiCashBuy,
      diiCashSell: data.diiCashSell,
      diiFutBuy: data.diiFutBuy,
      diiFutSell: data.diiFutSell,
      propdeskCashBuy: data.propdeskCashBuy,
      propdeskCashSell: data.propdeskCashSell,
      propdeskFutBuy: data.propdeskFutBuy,
      propdeskFutSell: data.propdeskFutSell,
      propdeskOptCallBuy: data.propdeskOptCallBuy,
      propdeskOptCallSell: data.propdeskOptCallSell,
      propdeskOptPutBuy: data.propdeskOptPutBuy,
      propdeskOptPutSell: data.propdeskOptPutSell,
      clientCashBuy: data.clientCashBuy,
      clientCashSell: data.clientCashSell,
      clientFutBuy: data.clientFutBuy,
      clientFutSell: data.clientFutSell,
      clientOptCallBuy: data.clientOptCallBuy,
      clientOptCallSell: data.clientOptCallSell,
      clientOptPutBuy: data.clientOptPutBuy,
      clientOptPutSell: data.clientOptPutSell,
    },
  });

  // Update isActive3Day flags: mark records within 3-day window
  await update3DayFlags();
  
  // Rebuild rolling window cache
  await rebuildRollingWindowCache(data.date);
}

/**
 * Update isActive3Day: Mark records within last 3 trading days
 * Older records still stored for backtesting, but signal engine
 * only uses isActive3Day = true records
 */
async function update3DayFlags(): Promise<void> {
  // Get last 3 trading days
  const recentDates = await prisma.institutionalFlow.findMany({
    where: { dataSource: 'nse_official' },
    orderBy: { date: 'desc' },
    take: 3,
    select: { date: true },
  });

  const activeDates = new Set(recentDates.map(r => r.date));

  // Mark all as inactive first
  await prisma.institutionalFlow.updateMany({
    where: { isActive3Day: true },
    data: { isActive3Day: false },
  });

  // Mark the 3 most recent as active
  if (activeDates.size > 0) {
    await prisma.institutionalFlow.updateMany({
      where: { date: { in: Array.from(activeDates) } },
      data: { isActive3Day: true },
    });
  }
}

// =====================================================
// 3-DAY ROLLING WINDOW
// Signal engine uses this — rebuilt daily after NSE data
// =====================================================

interface RollingWindowResult {
  totalFIINet3D: number;
  totalPropDeskNet3D: number;
  totalClientNet3D: number;
  totalDIINet3D: number;
  fiiTrend: string;
  propdeskTrend: string;
  clientTrend: string;
  dataCompleteness: number;
}

/**
 * Get 3-day rolling window for signal engine
 * Uses cached data (rebuilt daily after NSE data release)
 */
export async function get3DayRollingWindow(): Promise<RollingWindowResult | null> {
  // Try cache first
  const cache = await prisma.rollingWindowCache.findFirst({
    orderBy: { asOfDate: 'desc' },
  });

  if (cache) {
    return {
      totalFIINet3D: cache.totalFIINet3D,
      totalPropDeskNet3D: cache.totalPropDeskNet3D,
      totalClientNet3D: cache.totalClientNet3D,
      totalDIINet3D: cache.totalDIINet3D,
      fiiTrend: cache.fiiTrend,
      propdeskTrend: cache.propdeskTrend,
      clientTrend: cache.clientTrend,
      dataCompleteness: cache.dataCompleteness,
    };
  }

  return null;
}

/**
 * Rebuild the rolling window cache after new data arrives
 */
async function rebuildRollingWindowCache(asOfDate: string): Promise<void> {
  const activeRecords = await prisma.institutionalFlow.findMany({
    where: { isActive3Day: true },
    orderBy: { date: 'desc' },
  });

  if (activeRecords.length === 0) return;

  // Compute 3-day aggregates
  const totalFIINet3D = activeRecords.reduce((s, r) =>
    s + (r.fiiCashBuy - r.fiiCashSell) + (r.fiiFutBuy - r.fiiFutSell) +
    (r.fiiOptCallBuy - r.fiiOptCallSell) + (r.fiiOptPutBuy - r.fiiOptPutSell), 0);

  const totalPropDeskNet3D = activeRecords.reduce((s, r) =>
    s + (r.propdeskCashBuy - r.propdeskCashSell) + (r.propdeskFutBuy - r.propdeskFutSell) +
    (r.propdeskOptCallBuy - r.propdeskOptCallSell) + (r.propdeskOptPutBuy - r.propdeskOptPutSell), 0);

  const totalClientNet3D = activeRecords.reduce((s, r) =>
    s + (r.clientCashBuy - r.clientCashSell) + (r.clientFutBuy - r.clientFutSell) +
    (r.clientOptCallBuy - r.clientOptCallSell) + (r.clientOptPutBuy - r.clientOptPutSell), 0);

  const totalDIINet3D = activeRecords.reduce((s, r) =>
    s + (r.diiCashBuy - r.diiCashSell) + (r.diiFutBuy - r.diiFutSell), 0);

  // Trend detection
  const fiiTrend = totalFIINet3D > 1000 ? 'accumulating'
    : totalFIINet3D < -1000 ? 'distributing' : 'neutral';

  const propdeskTrend = totalPropDeskNet3D > 500 ? 'accumulating'
    : totalPropDeskNet3D < -500 ? 'distributing' : 'neutral';

  const clientTrend = totalClientNet3D > 1500 ? 'contrarian_bearish'
    : totalClientNet3D < -1500 ? 'contrarian_bullish' : 'neutral';

  const dataCompleteness = Math.min(1, activeRecords.length / 3);

  await prisma.rollingWindowCache.upsert({
    where: { asOfDate },
    create: {
      asOfDate,
      totalFIINet3D,
      totalPropDeskNet3D,
      totalClientNet3D,
      totalDIINet3D,
      fiiTrend,
      propdeskTrend,
      clientTrend,
      dataCompleteness,
    },
    update: {
      totalFIINet3D,
      totalPropDeskNet3D,
      totalClientNet3D,
      totalDIINet3D,
      fiiTrend,
      propdeskTrend,
      clientTrend,
      dataCompleteness,
    },
  });
}

// =====================================================
// AFTER-MARKET CORRELATION
// Once NSE releases data, we correlate live money flow
// with actual participant data to learn patterns
// =====================================================

/**
 * Run after-market correlation:
 * Match live money flow patterns with actual participant data
 * This helps us BETTER infer who is behind future live flows
 */
export async function runAfterMarketCorrelation(date: string): Promise<void> {
  const instData = await prisma.institutionalFlow.findUnique({ where: { date } });
  if (!instData) return;

  // Get all live snapshots for that date
  const snapshots = await prisma.liveMoneyFlowSnapshot.findMany({
    where: { date },
    orderBy: { timestamp: 'asc' },
  });

  if (snapshots.length === 0) return;

  // Total net flows for the day from live snapshots
  const totalLiveNetFlow = snapshots.reduce((s, sn) => s + sn.netFlow, 0);

  // Total net flows from NSE after-market data
  const fiiNet = (instData.fiiCashBuy - instData.fiiCashSell) +
    (instData.fiiFutBuy - instData.fiiFutSell) +
    (instData.fiiOptCallBuy - instData.fiiOptCallSell) +
    (instData.fiiOptPutBuy - instData.fiiOptPutSell);

  const propdeskNet = (instData.propdeskCashBuy - instData.propdeskCashSell) +
    (instData.propdeskFutBuy - instData.propdeskFutSell) +
    (instData.propdeskOptCallBuy - instData.propdeskOptCallSell) +
    (instData.propdeskOptPutBuy - instData.propdeskOptPutSell);

  const diiNet = (instData.diiCashBuy - instData.diiCashSell) +
    (instData.diiFutBuy - instData.diiFutSell);

  const clientNet = (instData.clientCashBuy - instData.clientCashSell) +
    (instData.clientFutBuy - instData.clientFutSell) +
    (instData.clientOptCallBuy - instData.clientOptCallSell) +
    (instData.clientOptPutBuy - instData.clientOptPutSell);

  // Correlation: What % of live flow was each participant
  const nseTotalNet = fiiNet + propdeskNet + diiNet + clientNet;
  const correlationConfidence = nseTotalNet !== 0 ? Math.min(1, Math.abs(totalLiveNetFlow / 10000000) / Math.abs(nseTotalNet)) : 0;

  const fiiPortion = nseTotalNet !== 0 ? fiiNet / nseTotalNet : 0;
  const propdeskPortion = nseTotalNet !== 0 ? propdeskNet / nseTotalNet : 0;
  const diiPortion = nseTotalNet !== 0 ? diiNet / nseTotalNet : 0;
  const clientPortion = nseTotalNet !== 0 ? clientNet / nseTotalNet : 0;

  // Update all snapshots with correlation data
  for (const snapshot of snapshots) {
    const snapshotNetFlow = snapshot.netFlow;
    await prisma.liveMoneyFlowSnapshot.update({
      where: { id: snapshot.id },
      data: {
        correlatedFII: snapshotNetFlow * fiiPortion,
        correlatedPropDesk: snapshotNetFlow * propdeskPortion,
        correlatedDII: snapshotNetFlow * diiPortion,
        correlatedClient: snapshotNetFlow * clientPortion,
        correlationConfidence,
      },
    });
  }
}

/**
 * Get all historical institutional data (for backtesting)
 * Signal engine should use get3DayRollingWindow() instead
 */
export async function getAllHistoricalData(days: number = 30) {
  return prisma.institutionalFlow.findMany({
    where: { dataSource: 'nse_official' },
    orderBy: { date: 'desc' },
    take: days,
  });
}

/**
 * Get data specifically for 3-day signal window
 */
export async function get3DayData() {
  return prisma.institutionalFlow.findMany({
    where: { isActive3Day: true },
    orderBy: { date: 'desc' },
  });
}
