#!/usr/bin/env python3
"""Sep 21 (Monday) daily 3-report read — Factor 12 + expiry-day prediction inputs."""

# ---- OI (contracts) ----
# order: FI_L, FI_S, FS_L, FS_S, IC_L, IP_L, IC_S, IP_S, SC_L, SP_L, SC_S, SP_S
oi = {
    'Sep21': {
        'Client': [297064, 55345, 3479598, 248080, 3801153, 3759123, 3618526, 4586864, 2905043, 931836, 1547786, 1292356],
        'DII':    [40954, 27774, 372103, 4583596, 8707, 69560, 2590, 0, 4196, 45676, 417945, 25357],
        'FII':    [47731, 338277, 3458177, 2953459, 724548, 1393670, 980904, 755240, 247834, 439013, 514178, 234738],
        'Pro':    [64099, 28452, 916159, 440902, 1157470, 1416784, 1089858, 1297033, 1060451, 1136396, 1737615, 1000470],
    },
    'Sep18': {
        'Client': [297981, 56561, 3469998, 230281, 3604780, 3094248, 3371765, 3890845, 2885665, 878682, 1528415, 1278326],
        'DII':    [40741, 27774, 365915, 4599506, 8009, 57485, 2390, 200, 5026, 45742, 403221, 24956],
        'FII':    [48406, 336834, 3448501, 2947706, 690977, 1299085, 959379, 668632, 231500, 431865, 501288, 222460],
        'Pro':    [64601, 30560, 906936, 413857, 1111636, 1192066, 1081869, 1083208, 1033584, 1128123, 1722851, 958670],
    },
}

# ---- Volume (contracts) ----
vol = {
    'Sep21': {
        'Client': [29865, 29566, 280821, 289020, 24842423, 22222130, 24892812, 22253274, 1725563, 736889, 1725556, 697765],
        'DII':    [213, 0, 141981, 119883, 998, 12950, 500, 675, 6609, 1201, 22163, 1668],
        'FII':    [11620, 13738, 216535, 212612, 2538619, 3056332, 2526573, 3048355, 429980, 221974, 426536, 227104],
        'Pro':    [12642, 11036, 266411, 284233, 30794257, 31074755, 30756412, 31063863, 3176285, 1767342, 3164182, 1800869],
    },
    'Sep18': {
        'Client': [29439, 26967, 250336, 238901, 19149604, 18168222, 19206986, 18252641, 1718361, 709930, 1730456, 716933],
        'DII':    [177, 68, 104281, 84504, 1520, 3050, 150, 600, 3078, 230, 1811, 875],
        'FII':    [9610, 7997, 246628, 285398, 2671215, 2780101, 2656725, 2762358, 427035, 251287, 433715, 236756],
        'Pro':    [10806, 15000, 317735, 310177, 21647413, 22040050, 21605891, 21975824, 3145708, 1769621, 3128200, 1776504],
    },
}

IDX = ['FI_L','FI_S','FS_L','FS_S','IC_L','IP_L','IC_S','IP_S','SC_L','SP_L','SC_S','SP_S']

def ls_ratio(row):
    L = row[0] + row[2] + row[4] + row[5] + row[8] + row[9]
    S = row[1] + row[3] + row[6] + row[7] + row[10] + row[11]
    return L, S, L / S if S else float('inf')

print('=' * 72)
print('CASH (fii-dii-combined-latest, 21-Sep-2026)')
print('=' * 72)
print('FII/FPI: BUY 10,637.17  SELL 11,213.37  NET -576.20 Cr   (Sep18: +628.47)')
print('DII    : BUY 14,098.64  SELL 11,301.37  NET +2,797.27 Cr (Sep18: +559.82)')
print(f'Net FII+DII: {(-576.20 + 2797.27):+.2f} Cr')

print()
print('=' * 72)
print('OI L/S RATIOS + DAY-OVER-DAY')
print('=' * 72)
for p in ['FII', 'Client', 'Pro', 'DII']:
    L, S, r = ls_ratio(oi['Sep21'][p])
    L0, S0, r0 = ls_ratio(oi['Sep18'][p])
    print(f'{p:7s} OI L/S: {r:.4f}  (Sep18 {r0:.4f})   L {L:>10,} S {S:>10,}')

print()
print('=' * 72)
print('VOLUME L/S RATIOS + DAY-OVER-DAY')
print('=' * 72)
for p in ['FII', 'Client', 'Pro']:
    L, S, r = ls_ratio(vol['Sep21'][p])
    L0, S0, r0 = ls_ratio(vol['Sep18'][p])
    print(f'{p:7s} VOL L/S: {r:.4f}  (Sep18 {r0:.4f})   L {L:>12,} S {S:>12,}')
idx_opt_total21 = sum(sum(vol['Sep21'][p][4:8]) for p in vol['Sep21'])
idx_opt_total18 = sum(sum(vol['Sep18'][p][4:8]) for p in vol['Sep18'])
print(f'Index option volume: {idx_opt_total21:,} (Sep18 {idx_opt_total18:,})  x{idx_opt_total21/idx_opt_total18:.2f}')

print()
print('=' * 72)
print('FII INDEX BOOK (contracts, net = L - S)')
print('=' * 72)
for d in ['Sep18', 'Sep21']:
    r = oi[d]['FII']
    print(f"{d}: IdxFut net {r[0]-r[1]:>+10,} | IdxCall net {r[4]-r[6]:>+10,} | IdxPut net {r[5]-r[7]:>+10,}")
print()
for p in ['FII', 'Client', 'Pro']:
    r = oi['Sep21'][p]; r0 = oi['Sep18'][p]
    print(f"{p:7s} d/d: IdxCallL {r[4]-r0[4]:>+9,}  IdxPutL {r[5]-r0[5]:>+9,}  IdxCallS {r[6]-r0[6]:>+9,}  IdxPutS {r[7]-r0[7]:>+9,}")

print()
print('=' * 72)
print('INDEX PCR (total OI)')
print('=' * 72)
call_oi = sum(oi['Sep21'][p][4] + oi['Sep21'][p][6] for p in oi['Sep21'])
put_oi = sum(oi['Sep21'][p][5] + oi['Sep21'][p][7] for p in oi['Sep21'])
call_oi0 = sum(oi['Sep18'][p][4] + oi['Sep18'][p][6] for p in oi['Sep18'])
put_oi0 = sum(oi['Sep18'][p][5] + oi['Sep18'][p][7] for p in oi['Sep18'])
print(f'Sep21: calls {call_oi:,}  puts {put_oi:,}  PCR-OI {put_oi/call_oi:.3f}')
print(f'Sep18: calls {call_oi0:,}  puts {put_oi0:,}  PCR-OI {put_oi0/call_oi0:.3f}')
print(f'd/d: call OI {call_oi-call_oi0:+,}  put OI {put_oi-put_oi0:+,}  (put growth x{(put_oi-put_oi0)/(call_oi-call_oi0):.1f} of call growth)')

print()
print('=' * 72)
print('SMART MONEY INDEX IMPACT (Task 42/43 algo: sign-corrected, FII.5/Pro.3/Client.2-rev/DII.1)')
print('=' * 72)
sign = {'IC': +1, 'IP': -1, 'FI': +1}
score = 0.0
for p, w in [('FII', 0.5), ('Pro', 0.3), ('DII', 0.1)]:
    r = oi['Sep21'][p]
    imp = w * ((r[0]-r[1]) * sign['FI'] + (r[4]-r[6]) * sign['IC'] + (r[5]-r[7]) * sign['IP'])
    score += imp
    print(f'{p:7s} index impact {imp:>+14,.0f} (w={w})')
r = oi['Sep21']['Client']
client_raw = (r[0]-r[1]) * sign['FI'] + (r[4]-r[6]) * sign['IC'] + (r[5]-r[7]) * sign['IP']
imp = 0.2 * (-client_raw)
score += imp
print(f'Client  index impact {imp:>+14,.0f} (w=0.2, REVERSED; raw {client_raw:+,})')
print(f'TOTAL index smart-money score: {score:+,.0f} contract-units -> {"BEARISH" if score < 0 else "BULLISH" if score > 0 else "NEUTRAL"} tilt')
