// Writes src/environments/environment.ts, which goes into the browser bundle: only public values.
// The client secret never goes here; it reaches only proxy-server.js through its environment.
const fs = require('fs');
const path = require('path');

const required = ['STARTGG_CLIENT_ID', 'STARTGG_REDIRECT_URI'];
const missing = required.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const environment = {
  production: true,
  startgg: {
    clientId: process.env.STARTGG_CLIENT_ID,
    redirectUri: process.env.STARTGG_REDIRECT_URI,
    scopes: 'user.identity',
    authUrl: 'https://start.gg/oauth/authorize',
  },
};

const content = `export const environment = ${JSON.stringify(environment, null, 2)};\n`;

const outPath = path.join(__dirname, '../src/environments/environment.ts');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, content);
console.log('Generated src/environments/environment.ts');
