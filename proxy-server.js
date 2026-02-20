// Simple OAuth proxy server for start.gg
// Run with: node proxy-server.js

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.STARTGG_CLIENT_ID;
const CLIENT_SECRET = process.env.STARTGG_CLIENT_SECRET;
const REDIRECT_URI = process.env.STARTGG_REDIRECT_URI || 'http://localhost:4200/callback';

app.use(cors());
app.use(express.json());

// Token exchange endpoint
app.post('/api/auth/token', async (req, res) => {
  try {
    const { code } = req.body;

    const response = await axios.post('https://api.start.gg/oauth/access_token', {
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code: code,
      scope: 'user.identity user.email',
      redirect_uri: REDIRECT_URI
    }, {
      headers: { 'Content-Type': 'application/json' }
    });

    res.json(response.data);
  } catch (error) {
    console.error('Token exchange error:', error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

// Token refresh endpoint
app.post('/api/auth/refresh', async (req, res) => {
  try {
    const { refresh_token } = req.body;

    const response = await axios.post('https://api.start.gg/oauth/refresh', {
      grant_type: 'refresh_token',
      refresh_token: refresh_token,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope: 'user.identity user.email',
      redirect_uri: REDIRECT_URI
    }, {
      headers: { 'Content-Type': 'application/json' }
    });

    res.json(response.data);
  } catch (error) {
    console.error('Token refresh error:', error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

app.listen(PORT, () => {
  console.log(`OAuth proxy server running on http://localhost:${PORT}`);
});
