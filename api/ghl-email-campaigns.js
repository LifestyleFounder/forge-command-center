// api/ghl-email-campaigns.js — Fetch GHL email campaign history with stats
// Proxies GHL API so the token stays server-side.

const GHL_URL = 'https://services.leadconnectorhq.com';
const LOCATION_ID = 'lNgTmLlqKbQL16uqww0g';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.GHL_API_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'GHL_API_TOKEN not configured in Vercel env vars' });
  }

  try {
    const limit = Math.min(Number(req.query.limit) || 100, 100);
    const skip = Number(req.query.skip) || 0;

    const params = new URLSearchParams({
      locationId: LOCATION_ID,
      limit: String(limit),
      skip: String(skip),
    });

    const apiRes = await fetch(`${GHL_URL}/emails/schedule?${params}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Version: '2021-07-28',
        Accept: 'application/json',
      },
    });

    const data = await apiRes.json();

    if (!apiRes.ok) {
      return res.status(apiRes.status).json({ error: data.message || data.msg || 'GHL API error' });
    }

    const schedules = data.schedules || data.data || [];

    const campaigns = schedules.map(s => {
      const sent = Number(s.sentCount || s.sent || 0);
      const delivered = Number(s.deliveredCount || s.delivered || 0);
      const failed = Number(s.failedCount || s.failed || 0);
      const opened = Number(s.openedCount || s.opened || 0);
      const clicked = Number(s.clickedCount || s.clicked || 0);

      return {
        id: s.id || s._id,
        name: s.name || s.subject || '(untitled)',
        subject: s.subject || s.name || '',
        status: s.status || 'completed',
        sentCount: sent,
        deliveredCount: delivered,
        failedCount: failed,
        openedCount: opened,
        clickedCount: clicked,
        deliveryRate: sent > 0 ? Number(((delivered / sent) * 100).toFixed(1)) : 0,
        openRate: delivered > 0 ? Number(((opened / delivered) * 100).toFixed(1)) : 0,
        clickRate: delivered > 0 ? Number(((clicked / delivered) * 100).toFixed(1)) : 0,
        date: s.scheduledAt || s.createdAt || s.updatedAt || null,
        campaignType: s.campaignType || s.type || 'email',
      };
    });

    // Sort by date descending
    campaigns.sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(b.date) - new Date(a.date);
    });

    const totalSent = campaigns.reduce((sum, c) => sum + c.sentCount, 0);
    const totalDelivered = campaigns.reduce((sum, c) => sum + c.deliveredCount, 0);
    const avgDeliveryRate = totalSent > 0 ? Number(((totalDelivered / totalSent) * 100).toFixed(1)) : 0;
    const lastCampaignDate = campaigns.length > 0 ? campaigns[0].date : null;

    const result = {
      lastUpdated: new Date().toISOString(),
      total: campaigns.length,
      summary: {
        totalCampaigns: campaigns.length,
        totalSent,
        totalDelivered,
        avgDeliveryRate,
        lastCampaignDate,
      },
      campaigns,
    };

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
