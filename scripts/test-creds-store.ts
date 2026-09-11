/**
 * Smoke test for the kite-creds-store isomorphic logic.
 * Run with: npx tsx scripts/test-creds-store.ts
 * (Server-side scenario only — browser no-op branches are guarded by
 * typeof window, which is undefined here, so the server path executes.)
 */
import { getStoredCredsSync, saveStoredCreds, clearStoredCreds, maskCreds } from '../src/lib/kite-creds-store';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

console.log('1. Empty store → null');
clearStoredCreds();
check('getStoredCredsSync() returns null when empty', getStoredCredsSync() === null);

console.log('2. Save → memory + file');
const now = Date.now();
const saved = saveStoredCreds('testapikey123456', 'testaccesstoken987654', now);
check('save returns entry', saved?.apiKey === 'testapikey123456' && saved?.savedAt === now);
check('memory read-back', getStoredCredsSync()?.accessToken === 'testaccesstoken987654');
check('savedAt preserved', getStoredCredsSync()?.savedAt === now);

console.log('3. File persistence (fresh module read path)');
const fs = eval('require')('fs');
const raw = JSON.parse(fs.readFileSync(process.cwd() + '/db/kite-creds.json', 'utf8'));
check('file contains creds', raw.apiKey === 'testapikey123456' && raw.savedAt === now);

console.log('4. Trim on save');
saveStoredCreds('  spacedkey  ', '  spacedtoken  ');
check('apiKey trimmed', getStoredCredsSync()?.apiKey === 'spacedkey');
check('accessToken trimmed', getStoredCredsSync()?.accessToken === 'spacedtoken');

console.log('5. Mask');
const m = maskCreds(getStoredCredsSync()!);
check('mask hides token body', m.tokenMasked.startsWith('spac') && m.tokenMasked.endsWith('oken'));

console.log('6. Clear');
clearStoredCreds();
check('cleared → null', getStoredCredsSync() === null);
check('file removed', !fs.existsSync(process.cwd() + '/db/kite-creds.json'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
