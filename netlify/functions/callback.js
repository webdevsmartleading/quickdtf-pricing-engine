// netlify/functions/callback.js
// Exchanges OAuth code for permanent Shopify access token

const CLIENT_ID     = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const SHOP          = process.env.SHOPIFY_STORE_DOMAIN;

exports.handler = async function(event) {
  const params = event.queryStringParameters || {};
  const code   = params.code;

  if (!code) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'No code provided' })
    };
  }

  try {
    const response = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code:          code
      })
    });

    const data = await response.json();

    if (data.access_token) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html' },
        body: `
          <html>
            <body style="font-family:sans-serif;padding:40px;max-width:600px;margin:0 auto;">
              <h2 style="color:#1A56F0;">✅ Success!</h2>
              <p>Your Admin API access token:</p>
              <code style="background:#f0f4ff;padding:16px;display:block;border-radius:8px;word-break:break-all;font-size:14px;">
                ${data.access_token}
              </code>
              <p style="color:#888;margin-top:20px;">Copy this token and add it to Netlify environment variables as <strong>SHOPIFY_ADMIN_API_TOKEN</strong></p>
            </body>
          </html>
        `
      };
    } else {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Token exchange failed', details: data })
      };
    }
  } catch(err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
