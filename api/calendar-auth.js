/**
 * GET /api/calendar-auth
 * Redirects to Google OAuth consent to authorize calendar.readonly + tasks scopes.
 * After consent, Google redirects to /api/calendar-callback.
 */
module.exports = (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    return res.end('GOOGLE_CLIENT_ID not configured');
  }

  const redirectUri = `https://${req.headers.host}/api/calendar-callback`;
  const scopes = [
    'https://www.googleapis.com/auth/tasks',
    'https://www.googleapis.com/auth/calendar.readonly',
  ].join(' ');

  const url = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&access_type=offline` +
    `&prompt=consent`;

  res.writeHead(302, { Location: url });
  res.end();
};
