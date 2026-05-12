exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { code } = JSON.parse(event.body);

    const response = await fetch('https://api.start.gg/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: process.env.STARTGG_CLIENT_ID,
        client_secret: process.env.STARTGG_CLIENT_SECRET,
        code,
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
