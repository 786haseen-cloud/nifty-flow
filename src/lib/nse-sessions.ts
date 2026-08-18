// NSE Session Calculator based on new CAS rules (Phase 1)
// CAS applicable to stocks with derivative contracts

import { NSESessionInfo, NSESessionType, NSE_SESSIONS } from './types';

/**
 * Calculate current NSE session based on IST time
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
      isCASActive: false,
      isDerivativesOpen: false,
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
      isCASActive: false,
      isDerivativesOpen: false,
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
      isCASActive: false,
      isDerivativesOpen: false,
      isRandomCloseWindow: false,
      nextSessionStart: '09:15',
      sessionLabel: 'Pre-Open Session (9:00-9:15)',
      casApplicable: true,
    };
  }
  
  // Continuous Trading Session (9:15 - 3:15 for CAS stocks)
  if (timeInMinutes >= CTS_START && timeInMinutes < CTS_END_CAS) {
    return {
      currentSession: 'continuous',
      currentTimeIST,
      isMarketOpen: true,
      isCASActive: false,
      isDerivativesOpen: true,
      isRandomCloseWindow: false,
      nextSessionStart: '15:15',
      sessionLabel: 'Continuous Trading (9:15-3:15) | Derivatives (9:15-3:40)',
      casApplicable: true,
    };
  }
  
  // CAS Transition (3:15 - 3:20) - Reference price calculation
  if (timeInMinutes >= CTS_END_CAS && timeInMinutes < CAS_TRANS_END) {
    return {
      currentSession: 'cas_transition',
      currentTimeIST,
      isMarketOpen: true,
      isCASActive: true,
      isDerivativesOpen: true,
      isRandomCloseWindow: false,
      nextSessionStart: '15:20',
      sessionLabel: '⚠️ CAS Transition (3:15-3:20) — Ref Price Calc | Derivatives Open',
      casApplicable: true,
    };
  }
  
  // CAS Order Entry (3:20 - 3:30) with random close window 3:28-3:30
  if (timeInMinutes >= CAS_ORDER_START && timeInMinutes < CAS_ORDER_END) {
    const isRandomWindow = timeInMinutes >= CAS_RANDOM_START;
    return {
      currentSession: 'cas_order_entry',
      currentTimeIST,
      isMarketOpen: true,
      isCASActive: true,
      isDerivativesOpen: true,
      isRandomCloseWindow: isRandomWindow,
      nextSessionStart: isRandomWindow ? '~3:30 (random close)' : '3:28',
      sessionLabel: isRandomWindow
        ? '🔴 CAS Order Entry (3:28-3:30) — RANDOM CLOSE WINDOW! | Derivatives Open'
        : '📋 CAS Order Entry (3:20-3:28) — Limit orders only after 3:25 | Derivatives Open',
      casApplicable: true,
    };
  }
  
  // CAS Matching (3:30 - 3:35)
  if (timeInMinutes >= CAS_MATCH_END - 5 && timeInMinutes < CAS_MATCH_END) {
    return {
      currentSession: 'cas_matching',
      currentTimeIST,
      isMarketOpen: true,
      isCASActive: true,
      isDerivativesOpen: timeInMinutes < DERIV_END,
      isRandomCloseWindow: false,
      nextSessionStart: '15:35',
      sessionLabel: '⚖️ CAS Order Matching (3:30-3:35) | Derivatives ' + (timeInMinutes < DERIV_END ? 'Open' : 'Closed'),
      casApplicable: true,
    };
  }
  
  // CAS Post-transition (3:35 - 3:50)
  if (timeInMinutes >= CAS_MATCH_END && timeInMinutes < CAS_POST_END) {
    return {
      currentSession: 'cas_transition_post',
      currentTimeIST,
      isMarketOpen: true,
      isCASActive: false,
      isDerivativesOpen: timeInMinutes < DERIV_END,
      isRandomCloseWindow: false,
      nextSessionStart: '15:50',
      sessionLabel: 'CAS Post-Transition (3:35-3:50) | Derivatives ' + (timeInMinutes < DERIV_END ? 'till 3:40' : 'Closed'),
      casApplicable: true,
    };
  }
  
  // Post Close (3:50 - 4:00)
  if (timeInMinutes >= CAS_POST_END && timeInMinutes < POST_CLOSE_END) {
    return {
      currentSession: 'post_close',
      currentTimeIST,
      isMarketOpen: true,
      isCASActive: false,
      isDerivativesOpen: false,
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
    isCASActive: false,
    isDerivativesOpen: false,
    isRandomCloseWindow: false,
    nextSessionStart: 'Tomorrow 09:00',
    sessionLabel: 'Market Closed',
    casApplicable: true,
  };
}

/**
 * Get all NSE session timings for display
 */
export function getNSESessionTimings() {
  return [
    { session: 'Pre-Open', time: '09:00 - 09:15', type: 'pre_open' as NSESessionType, description: 'Order collection, price discovery' },
    { session: 'Continuous Trading (CTS)', time: '09:15 - 15:15', type: 'continuous' as NSESessionType, description: 'CAS stocks continuous trading' },
    { session: 'Non-CAS Stocks', time: '09:15 - 15:30', type: 'continuous' as NSESessionType, description: 'Non-derivative stocks trade till 3:30 PM' },
    { session: 'CAS Transition', time: '15:15 - 15:20', type: 'cas_transition' as NSESessionType, description: 'Reference price calculation, CTS→CAS transition' },
    { session: 'CAS Order Entry I', time: '15:20 - 15:25', type: 'cas_order_entry' as NSESessionType, description: 'Limit + Market orders: entry, modify, cancel' },
    { session: 'CAS Order Entry II', time: '15:25 - 15:30', type: 'cas_order_entry' as NSESessionType, description: 'Limit orders only. No market orders. Random close ⚠️' },
    { session: 'CAS Matching', time: '15:30 - 15:35', type: 'cas_matching' as NSESessionType, description: 'Order matching & trade confirmation' },
    { session: 'CAS Post-Transition', time: '15:35 - 15:50', type: 'cas_transition_post' as NSESessionType, description: 'CAS → Post close transition' },
    { session: 'Post Close', time: '15:50 - 16:00', type: 'post_close' as NSESessionType, description: 'Post close session' },
    { session: 'Equity Derivatives', time: '09:15 - 15:40', type: 'derivatives' as NSESessionType, description: 'Extended till 3:40 PM (was 3:30 PM)' },
  ];
}
