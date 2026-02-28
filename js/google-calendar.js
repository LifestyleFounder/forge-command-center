/* ============================================================
   google-calendar.js — Fetch upcoming events from Google Calendar API
   ============================================================ */

const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? 'http://localhost:3000/api'
  : '/api';

export async function getUpcomingEvents() {
  const data = await fetch(`${API_BASE}/calendar`).then(r => r.json());
  if (data.error) throw new Error(data.error);

  return (data.events || []).slice(0, 8).map(e => ({
    id: e.id,
    title: e.summary || '(No title)',
    start: e.start,
    end: e.end,
    allDay: !!e.start.date,
    link: e.htmlLink || '#',
  }));
}
