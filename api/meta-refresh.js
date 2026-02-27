// api/meta-refresh.js — Vercel serverless function
// Proxies Meta Graph API requests so the token stays server-side.

const GRAPH_URL = 'https://graph.facebook.com/v19.0';
const ACCOUNT = 'act_285954345865882';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'META_ACCESS_TOKEN not configured in Vercel env vars' });
  }

  try {
    const preset = req.query.preset || 'last_7d';

    // 1. Account-level summary
    const summaryParams = new URLSearchParams({
      fields: 'spend,impressions,clicks,cpc,cpm,ctr,actions,action_values',
      date_preset: preset,
      access_token: token,
    });
    const summaryRes = await fetch(`${GRAPH_URL}/${ACCOUNT}/insights?${summaryParams}`);
    const summaryData = await summaryRes.json();

    if (summaryData.error) {
      return res.status(400).json({ error: summaryData.error.message });
    }

    const row = (summaryData.data || [])[0] || {};

    // 2. Campaign-level breakdown
    let campaigns = [];
    try {
      const campParams = new URLSearchParams({
        fields: 'campaign_name,spend,impressions,clicks,ctr,cpc,actions',
        date_preset: preset,
        level: 'campaign',
        access_token: token,
      });
      const campRes = await fetch(`${GRAPH_URL}/${ACCOUNT}/insights?${campParams}`);
      const campData = await campRes.json();

      if (campData.data && campData.data.length > 0) {
        campaigns = campData.data.map(r => ({
          name: r.campaign_name,
          status: 'ACTIVE',
          spend: Number(r.spend || 0),
          impressions: Number(r.impressions || 0),
          clicks: Number(r.clicks || 0),
          ctr: Number(parseFloat(r.ctr || 0).toFixed(2)),
          cpc: Number(parseFloat(r.cpc || 0).toFixed(2)),
          leads: getAction(r.actions, 'lead'),
          applications: getAction(r.actions, 'offsite_conversion.fb_pixel_custom'),
        }));
      }
    } catch (_) { /* campaign level is optional */ }

    // 3. Campaign statuses
    try {
      const statusParams = new URLSearchParams({
        fields: 'name,status',
        limit: '50',
        access_token: token,
      });
      const statusRes = await fetch(`${GRAPH_URL}/${ACCOUNT}/campaigns?${statusParams}`);
      const statusData = await statusRes.json();
      if (statusData.data) {
        const statusMap = Object.fromEntries(statusData.data.map(c => [c.name, c.status]));
        campaigns.forEach(c => { if (statusMap[c.name]) c.status = statusMap[c.name]; });
      }
    } catch (_) { /* statuses are nice-to-have */ }

    const spend = Number(row.spend || 0);
    const leads = getAction(row.actions, 'lead');
    const apps = getAction(row.actions, 'offsite_conversion.fb_pixel_custom');
    const revenue = Number((row.action_values || []).find(a => a.action_type === 'purchase')?.value || 0);

    const result = {
      lastUpdated: new Date().toISOString(),
      summary: {
        spend,
        leads,
        applications: apps,
        cpl: leads > 0 ? Number((spend / leads).toFixed(2)) : 0,
        roas: spend > 0 && revenue > 0 ? Number((revenue / spend).toFixed(2)) : 0,
        impressions: Number(row.impressions || 0),
        revenue,
        clicks: Number(row.clicks || 0),
        cpc: Number(parseFloat(row.cpc || 0).toFixed(2)),
        cpm: Number(parseFloat(row.cpm || 0).toFixed(2)),
        ctr: Number(parseFloat(row.ctr || 0).toFixed(2)),
        period: preset,
        registrations: getAction(row.actions, 'complete_registration'),
        landingPageViews: getAction(row.actions, 'landing_page_view'),
        videoViews: getAction(row.actions, 'video_view'),
        conversations: getAction(row.actions, 'onsite_conversion.messaging_conversation_started_7d'),
      },
      campaigns,
    };

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function getAction(actions, type) {
  return Number((actions || []).find(a => a.action_type === type)?.value || 0);
}
