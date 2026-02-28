/**
 * GET /api/calendar-callback
 * Receives the OAuth authorization code from Google, exchanges it for
 * a refresh token, and displays it so Dan can paste it into Vercel env vars.
 */
const https = require('https');

function post(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body.toString();
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => {
        try { resolve(JSON.parse(chunks)); }
        catch { resolve(chunks); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

module.exports = async (req, res) => {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    return res.end(`<h2>Auth failed</h2><p>${error}</p>`);
  }

  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    return res.end('<h2>No authorization code received</h2>');
  }

  try {
    const redirectUri = `https://${req.headers.host}/api/calendar-callback`;
    const body = new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });

    const tokens = await post('https://oauth2.googleapis.com/token', body);

    if (tokens.error) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      return res.end(`<h2>Token exchange failed</h2><pre>${JSON.stringify(tokens, null, 2)}</pre>`);
    }

    const refreshToken = tokens.refresh_token || '(no refresh token returned — was prompt=consent set?)';

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head><title>Calendar Auth Success</title>
      <style>
        body { font-family: system-ui; max-width: 600px; margin: 60px auto; padding: 0 20px; background: #f7f3ea; color: #0f2a1e; }
        h2 { color: #0f2a1e; }
        .token-box { background: #fff; border: 2px solid #0f2a1e; border-radius: 8px; padding: 16px; word-break: break-all; font-family: monospace; font-size: 13px; margin: 16px 0; }
        .steps { background: #fff; border-radius: 8px; padding: 16px; margin-top: 24px; }
        .steps li { margin: 8px 0; }
        code { background: #e8e4dc; padding: 2px 6px; border-radius: 4px; }
      </style></head>
      <body>
        <h2>Calendar authorized</h2>
        <p>Copy this refresh token and update it in Vercel:</p>
        <div class="token-box">${refreshToken}</div>
        <div class="steps">
          <strong>Next steps:</strong>
          <ol>
            <li>Go to <a href="https://vercel.com" target="_blank">Vercel Dashboard</a> → forge-command-center → Settings → Environment Variables</li>
            <li>Update <code>GOOGLE_REFRESH_TOKEN</code> with the value above</li>
            <li>Redeploy (push any commit or click Redeploy in Vercel)</li>
            <li>Delete these auth routes once confirmed working</li>
          </ol>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(`<h2>Error</h2><pre>${err.message}</pre>`);
  }
};
