// Fails if a built bundle could leak the start.gg client secret.
//   node scripts/check-bundle.js <dist dir> <placeholder>
// Every clientSecret value in the bundle must equal the placeholder, and the real secret,
// if this environment has one in STARTGG_CLIENT_SECRET_REAL, must not appear anywhere.
const fs = require('fs');
const path = require('path');

const [dir, placeholder] = process.argv.slice(2);
if (!dir || !placeholder) {
  console.error('usage: node scripts/check-bundle.js <dist dir> <placeholder>');
  process.exit(2);
}
const real = process.env.STARTGG_CLIENT_SECRET_REAL;

const files = [];
const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
  const p = path.join(d, e.name);
  if (e.isDirectory()) walk(p);
  else files.push(p);
});
walk(dir);

let bad = 0;
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/clientSecret\s*:\s*(["'`])((?:(?!\1).)*)\1/g)) {
    if (m[2] !== placeholder) {
      console.error(`${file}: clientSecret has a value other than the placeholder`);
      bad++;
    }
  }
  if (real && text.includes(real)) {
    console.error(`${file}: contains the client secret`);
    bad++;
  }
}
if (!files.some(f => f.endsWith('.js'))) {
  console.error(`no JavaScript files in ${dir}`);
  bad++;
}
if (bad) process.exit(1);
console.log(`checked ${files.length} files: no client secret`);
