const fs = require('fs');
const f = '/home/z/my-project/src/components/dashboard/settings-config.tsx';
let c = fs.readFileSync(f, 'utf-8');
const lines = c.split('\n');

// Show lines 92-96
for (let i = 91; i <= 95; i++) {
  console.log(`${i+1}: ${JSON.stringify(lines[i])}`);
