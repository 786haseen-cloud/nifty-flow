// NSE Session Calculator based on new CAS rules (Phase 1)
// CAS applicable to stocks with derivative contracts
// KEY RULE: During CAS (3:15-3:35 PM), OPTIONS & FUTURES CONTINUE TRADING
//           Only CASH trading stops during CAS

import { NSESessionInfo, NSESessionType, NSE_SESSIONS } from './types';

/**
 * Calculate current NSE session based on IST time
 * 
 * CRITICAL: During CAS (3:15-3:35 PM):
 *   - CASH trading STOPS (CAS auction determines closing price)
 *   - OPTIONS & FUTURES CONTINUE trading normally
 *   - Equity Derivatives segment open till 3:40 PM
 */
export function getNSESession(istTime: Date = new Date()): NSESessionInfo {
  // Convert to IST if not already
  const istOffset = 5.5 * 60 * 60 * 1000; // +5:30
  const utc = istTime.getTime() + istTime.getTimezoneOffset() * 60 * 1000;
  const ist = new Date(utc + istOffset);
  
  const hours = ist.getHours();
  const minutes = ist.getMinutes();
  const timeInMinutes = hours * 60 + minutes;
  const day = ist.getDay(); // 0=Sun, 6=Sat
  
  const currentTimeIST = `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}`;
  
  // Weekend - market closed
  if (day === 0 || day === 6) {
    return {
      currentSession: 'closed',
      currentTimeIST,
      isMarketOpen: false,
      isCashActive: false,
      isDerivativesOpen: false,
      isCASActive: false,
      isRandomCloseWindow: false,
      nextSessionStart: 'Monday 09:00',
      sessionLabel: 'Market Closed (Weekend)',
      casApplicable: true,
    };
  }
  
  // Time boundaries in minutes from midnight
  const PRE_OPEN = 9 * 60;        // 540 (9:00)
  const CTS_START = 9 * 60 + 15;  // 555 (9:15)
  const CTS_END_CAS = 15 * 60 + 15; // 915 (3:15)
  const CAS_TRANS_END = 15 * 60 + 20; // 920 (3:20)
  const CAS_ORDER_START = 15 * 60 + 20; // 920 (3:20)
  const CAS_RANDOM_START = 15 * 60 + 28; // 928 (3:28)
  const CAS_ORDER_END = 15 * 60 + 30;    // 930 (3:30)
  const CAS_MATCH_END = 15 * 60 + 35;    // 935 (3:35)
  const CAS_POST_END = 15 * 60 + 50;     // 950 (3:50)
  const POST_CLOSE_END = 16 * 60;        // 960 (4:00)
  const DERIV_END = 15 * 60 + 40;        // 940 (3:40)
  
  // Before market
  if (timeInMinutes < PRE_OPEN) {
    return {
      currentSession: 'closed',
      currentTimeIST,
      isMarketOpen: false,
      isCashActive: false,
      isDerivativesOpen: false,
      isCASActive: false,
      isRandomCloseWindow: false,
      nextSessionStart: '09:00',
      sessionLabel: `Pre-Market (opens at 09:00)`,
      casApplicable: true,
    };
  }
  
  // Pre-open session (9:00 - 9:15)
  if (timeInMinutes >= PRE_OPEN && timeInMinutes < CTS_START) {
    return {
      currentSession: 'pre_open',
      currentTimeIST,
      isMarketOpen: true,
      isCashActive: false,   // Pre-open: no cash trading yet
      isDerivativesOpen: false,
      isCASActive: false,
      isRandomCloseWindow: false,
      nextSessionStart: '09:15',
      sessionLabel: 'Pre-Open Session (9:00-9:15)',
      casApplicable: true,
    };
  }
  
  // Continuous Trading Session (9:15 - 3:15 for CAS stocks)
  // Cash AND Derivatives both active
  if (timeInMinutes >= CTS_START && timeInMinutes < CTS_END_CAS) {
    return {
      currentSession: 'continuous',
      currentTimeIST,
      isMarketOpen: true,
      isCashActive: true,     // Cash is ACTIVE during CTS
      isDerivativesOpen: true,
      isCASActive: false,
      isRandomCloseWindow: false,
      nextSessionStart: '15:15',
      sessionLabel: 'Continuous Trading (9:15-3:15) | Cash + F&O Active',
      casApplicable: true,
    };
  }
  
  // CAS Transition (3:15 - 3:20) - Reference price calculation
  // CASH PAUSED | F&O CONTINUES
  if (timeInMinutes >= CTS_END_CAS && timeInMinutes < CAS_TRANS_END) {
    return {
      currentSession: 'cas_transition',
      currentTimeIST,
      isMarketOpen: true,
      isCashActive: false,    // ⛔ CASH PAUSED - CAS transition
      isDerivativesOpen: true, // ✅ F&O CONTINUES
      isCASActive: true,
      isRandomCloseWindow: false,
      nextSessionStart: '15:20',
      sessionLabel: '⛔ CAS Transition (3:15-3:20) — CASH PAUSED, Ref Price Calc | ✅ F&O ACTIVE',
      casApplicable: true,
    };
  }
  
  // CAS Order Entry (3:20 - 3:30) with random close window 3:28-3:30
  // CASH PAUSED (auction orders only) | F&O CONTINUES
  if (timeInMinutes >= CAS_ORDER_START && timeInMinutes < CAS_ORDER_END) {
    const isRandomWindow = timeInMinutes >= CAS_RANDOM_START;
    return {
      currentSession: 'cas_order_entry',
      currentTimeIST,
      isMarketOpen: true,
      isCashActive: false,    // ⛔ CASH PAUSED - CAS order entry
      isDerivativesOpen: true, // ✅ F&O CONTINUES
      isCASActive: true,
      isRandomCloseWindow: isRandomWindow,
      nextSessionStart: isRandomWindow ? '~3:30 (random close)' : '3:28',
      sessionLabel: isRandomWindow
        ? '⛔ CAS Order Entry (3:28-3:30) — RANDOM CLOSE! | ✅ F&O ACTIVE'
        : '⛔ CAS Order Entry (3:20-3:28) — Cash Auction | ✅ F&O CONTINUES',
      casApplicable: true,
    };
  }
  
  // CAS Matching (3:30 - 3:35)
  // CASH PAUSED (matching) | F&O still continues till 3:40
  if (timeInMinutes >= CAS_MATCH_END - 5 && timeInMinutes < CAS_MATCH_END) {
    return {
      currentSession: 'cas_matching',
      currentTimeIST,
      isMarketOpen: true,
      isCashActive: false,    // ⛔ CASH PAUSED - CAS matching
      isDerivativesOpen: timeInMinutes < DERIV_END, // F&O continues till 3:40
      isCASActive: true,
      isRandomCloseWindow: false,
      nextSessionStart: '15:35',
      sessionLabel: '⛔ CAS Matching (3:30-3:35) | ✅ F&O ' + (timeInMinutes < DERIV_END ? 'ACTIVE' : 'Closed'),
      casApplicable: true,
    };
  }
  
  // CAS Post-transition (3:35 - 3:50)
  // Cash closed for the day | F&O still active till 3:40
  if (timeInMinutes >= CAS_MATCH_END && timeInMinutes < CAS_POST_END) {
    return {
      currentSession: 'cas_transition_post',
      currentTimeIST,
      isMarketOpen: true,
      isCashActive: false,    // Cash done for the day
      isDerivativesOpen: timeInMinutes < DERIV_END,
      isCASActive: false,
      isRandomCloseWindow: false,
      nextSessionStart: '15:50',
      sessionLabel: 'CAS Complete (3:35-3:50) | F&O ' + (timeInMinutes < DERIV_END ? 'till 3:40' : 'Closed'),
      casApplicable: true,
    };
  }
  
  // Post Close (3:50 - 4:00)
  if (timeInMinutes >= CAS_POST_END && timeInMinutes < POST_CLOSE_END) {
    return {
      currentSession: 'post_close',
      currentTimeIST,
      isMarketOpen: true,
      isCashActive: false,
      isDerivativesOpen: false,
      isCASActive: false,
      isRandomCloseWindow: false,
      nextSessionStart: '16:00',
      sessionLabel: 'Post Close Session (3:50-4:00)',
      casApplicable: true,
    };
  }
  
  // After market
  return {
    currentSession: 'closed',
    currentTimeIST,
    isMarketOpen: false,
    isCashActive: false,
    isDerivativesOpen: false,
    isCASActive: false,
    isRandomCloseWindow: false,
    nextSessionStart: 'Tomorrow 09:00',
    sessionLabel: 'Market Closed',
    casApplicable: true,
  };
}

/**
 * Get all NSE session timings for display
 * Updated to clearly show Cash vs F&O status in each session
 */
export function getNSESessionTimings() {
  return [
    { session: 'Pre-Open', time: '09:00 - 09:15', type: 'pre_open' as NSESessionType, description: 'Order collection, price discovery', cashStatus: 'Closed', foStatus: 'Closed' },
    { session: 'Continuous Trading (CTS)', time: '09:15 - 15:15', type: 'continuous' as NSESessionType, description: 'Cash + F&O both active', cashStatus: 'Active', foStatus: 'Active' },
    { session: 'Non-CAS Stocks', time: '09:15 - 15:30', type: 'continuous' as NSESessionType, description: 'Non-derivative stocks trade till 3:30 PM', cashStatus: 'Active', foStatus: 'N/A' },
    { session: 'CAS Transition', time: '15:15 - 15:20', type: 'cas_transition' as NSESessionType, description: '⛔ CASH PAUSED (ref price calc) | ✅ F&O CONTINUES', cashStatus: 'PAUSED', foStatus: 'Active' },
    { session: 'CAS Order Entry I', time: '15:20 - 15:25', type: 'cas_order_entry' as NSESessionType, description: '⛔ Cash auction orders | ✅ F&O CONTINUES', cashStatus: 'PAUSED', foStatus: 'Active' },
    { session: 'CAS Order Entry II', time: '15:25 - 15:30', type: 'cas_order_entry' as NSESessionType, description: '⛔ Cash limit only | ✅ F&O CONTINUES | Random close ⚠️', cashStatus: 'PAUSED', foStatus: 'Active' },
    { session: 'CAS Matching', time: '15:30 - 15:35', type: 'cas_matching' as NSESessionType, description: '⛔ Cash matching | ✅ F&O CONTINUES', cashStatus: 'PAUSED', foStatus: 'Active' },
    { session: 'CAS Post-Transition', time: '15:35 - 15:50', type: 'cas_transition_post' as NSESessionType, description: 'Cash done for day | F&O till 3:40', cashStatus: 'Done', foStatus: 'Till 3:40' },
    { session: 'Post Close', time: '15:50 - 16:00', type: 'post_close' as NSESessionType, description: 'Post close session', cashStatus: 'Done', foStatus: 'Done' },
    { session: 'Equity Derivatives', time: '09:15 - 15:40', type: 'derivatives' as NSESessionType, description: 'F&O segment — continues even during CAS!', cashStatus: 'N/A', foStatus: 'Active' },
  ];
}
