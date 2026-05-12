exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { refresh_token } = JSON.parse(event.body);

    const response = await fetch('https://api.start.gg/oauth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token,
        client_id: process.env.STARTGG_CLIENT_ID,
        client_secret: process.env.STARTGG_CLIENT_SECRET,
        scope: 'user.identity user.email',
        redirect_uri: process.env.STARTGG_REDIRECT_URI
      })
    });

    const data = await response.json();
    return {
      statusCode: response.status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
