const fs = require('fs');
const path = require('path');

const required = ['STARTGG_CLIENT_ID', 'STARTGG_CLIENT_SECRET', 'STARTGG_REDIRECT_URI'];
const missing = required.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const content = `export const environment = {
  production: true,
  startgg: {
    clientId: '${process.env.STARTGG_CLIENT_ID}',
    clientSecret: '${process.env.STARTGG_CLIENT_SECRET}',
    redirectUri: '${process.env.STARTGG_REDIRECT_URI}',
    scopes: 'user.identity user.email',
    authUrl: 'https://start.gg/oauth/authorize',
    tokenUrl: 'https://api.start.gg/oauth/access_token',
    refreshUrl: 'https://api.start.gg/oauth/refresh'
  }
};
`;

const outPath = path.join(__dirname, '../src/environments/environment.ts');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, content);
console.log('Generated src/environments/environment.ts');
