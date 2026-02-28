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
          leads: getCampaignLeads(r.actions),
          applications: getAction(r.actions, 'offsite_conversion.fb_pixel_custom'),
        }));
      }
    } catch (_) { /* campaign level is optional */ }

    // 2b. Daily breakdown for charts
    let daily = [];
    try {
      const dailyParams = new URLSearchParams({
        fields: 'spend,impressions,clicks,actions',
        date_preset: preset,
        time_increment: '1',
        limit: '31',
        access_token: token,
      });
      const dailyRes = await fetch(`${GRAPH_URL}/${ACCOUNT}/insights?${dailyParams}`);
      const dailyData = await dailyRes.json();

      if (dailyData.data && dailyData.data.length > 0) {
        daily = dailyData.data.map(d => ({
          date: d.date_start,
          spend: Number(d.spend || 0),
          impressions: Number(d.impressions || 0),
          clicks: Number(d.clicks || 0),
          leads: Math.max(getAction(d.actions, 'lead'), getAction(d.actions, 'complete_registration')),
          applications: getAction(d.actions, 'offsite_conversion.fb_pixel_custom'),
        }));
      }
    } catch (_) { /* daily is optional */ }

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
    // Sum per-campaign leads for accuracy (avoids double-counting lead vs complete_registration)
    const leads = campaigns.length > 0
      ? campaigns.reduce((sum, c) => sum + c.leads, 0)
      : getLeads(row.actions);
    const apps = campaigns.length > 0
      ? campaigns.reduce((sum, c) => sum + c.applications, 0)
      : getAction(row.actions, 'offsite_conversion.fb_pixel_custom');
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
      daily,
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

// Count leads: different campaigns use different events.
// Skool Ads → complete_registration, IG DM → lead, Retargeting → offsite_conversion.fb_pixel_custom (apps).
// Per campaign: take the higher of lead vs complete_registration (avoids noise from CAPI dupes).
// Account level: sum per-campaign leads for accuracy.
function getLeads(actions) {
  const lead = getAction(actions, 'lead');
  const reg = getAction(actions, 'complete_registration');
  // At account level, lead and reg may overlap, so take the higher value
  // plus any DM-only leads that wouldn't show as registrations
  return Math.max(lead, reg);
}

function getCampaignLeads(actions) {
  const lead = getAction(actions, 'lead');
  const reg = getAction(actions, 'complete_registration');
  return Math.max(lead, reg);
}
