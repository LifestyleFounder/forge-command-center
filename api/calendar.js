const { calendarAPI, cors, json } = require('./_google-tasks');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  try {
    const url = new URL(req.url, `https://${req.headers.host}`);

    // Debug: list all calendars
    if (url.searchParams.get('debug') === 'calendars') {
      const list = await calendarAPI('/calendar/v3/users/me/calendarList');
      const cals = (list.items || []).map(c => ({ id: c.id, summary: c.summary, primary: c.primary || false }));
      return json(res, 200, { calendars: cals });
    }

    const calId = url.searchParams.get('cal') || 'primary';
    const now = new Date();
    const timeMin = now.toISOString();
    const timeMax = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();

    const data = await calendarAPI(
      `/calendar/v3/calendars/${encodeURIComponent(calId)}/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&maxResults=20&singleEvents=true&orderBy=startTime`
    );

    const events = (data.items || []).map(e => ({
      id: e.id,
      summary: e.summary || '(No title)',
      start: e.start,
      end: e.end,
      htmlLink: e.htmlLink,
    }));

    return json(res, 200, { events, calendarId: calId });
  } catch (err) {
    console.error('Calendar API error:', err);
    return json(res, 500, { error: err.message });
  }
};
