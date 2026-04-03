// api/daily-metrics.js — Daily cron that auto-populates LFG Performance Tracker
// Runs at noon UTC (4am PT) via Vercel cron.
// Pulls: campaign_spend (Meta), free_group_joins/applications/calls_booked (Supabase), chat_starts (Sendblue)
// POSTs to tracker webhook.

const GRAPH_URL = 'https://graph.facebook.com/v19.0';
const META_ACCOUNT = 'act_285954345865882';
const SENDBLUE_URL = 'https://api.sendblue.co';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Allow manual trigger via GET or cron trigger
  const webhookUrl = process.env.TRACKER_WEBHOOK_URL;
  const webhookKey = process.env.TRACKER_API_KEY;

  if (!webhookUrl || !webhookKey) {
    return res.status(500).json({ error: 'TRACKER_WEBHOOK_URL or TRACKER_API_KEY not configured' });
  }

  // Yesterday's date in YYYY-MM-DD
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().slice(0, 10);

  const results = { date: dateStr };
  const errors = [];

  // Run all data fetches in parallel
  const [metaResult, supabaseResult, sendblueResult] = await Promise.allSettled([
    fetchMetaSpend(dateStr),
    fetchFunnelMetrics(dateStr),
    fetchChatStarts(dateStr),
  ]);

  // Meta Ads — campaign_spend
  if (metaResult.status === 'fulfilled' && metaResult.value !== null) {
    results.campaign_spend = metaResult.value;
  } else {
    errors.push({ source: 'meta', error: metaResult.reason?.message || 'No data' });
  }

  // Supabase funnel_events — free_group_joins, applications, calls_booked
  if (supabaseResult.status === 'fulfilled' && supabaseResult.value) {
    Object.assign(results, supabaseResult.value);
  } else {
    errors.push({ source: 'supabase', error: supabaseResult.reason?.message || 'No data' });
  }

  // Sendblue — chat_starts
  if (sendblueResult.status === 'fulfilled' && sendblueResult.value !== null) {
    results.chat_starts = sendblueResult.value;
  } else {
    errors.push({ source: 'sendblue', error: sendblueResult.reason?.message || 'No data' });
  }

  // Only POST if we have at least one metric beyond date
  if (Object.keys(results).length <= 1) {
    return res.status(500).json({ error: 'All data sources failed', errors });
  }

  // POST to tracker webhook
  try {
    const postRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': webhookKey,
      },
      body: JSON.stringify(results),
    });

    const postData = await postRes.json().catch(() => ({}));

    if (!postRes.ok) {
      return res.status(502).json({
        error: 'Webhook POST failed',
        status: postRes.status,
        response: postData,
        payload: results,
      });
    }

    return res.status(200).json({
      success: true,
      date: dateStr,
      metrics: results,
      errors: errors.length > 0 ? errors : undefined,
      webhook_response: postData,
    });
  } catch (err) {
    return res.status(500).json({ error: `Webhook POST error: ${err.message}`, payload: results });
  }
}

// --- Data fetchers ---

async function fetchMetaSpend(dateStr) {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error('META_ACCESS_TOKEN not configured');

  const params = new URLSearchParams({
    fields: 'spend',
    time_range: JSON.stringify({ since: dateStr, until: dateStr }),
    access_token: token,
  });

  const response = await fetch(`${GRAPH_URL}/${META_ACCOUNT}/insights?${params}`);
  const data = await response.json();

  if (data.error) throw new Error(data.error.message);

  const row = (data.data || [])[0];
  if (!row) return 0;

  return Number(row.spend || 0);
}

async function fetchFunnelMetrics(dateStr) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error('SUPABASE_URL or SUPABASE_SERVICE_KEY not configured');

  const sinceISO = `${dateStr}T00:00:00Z`;
  const untilISO = `${dateStr}T23:59:59.999Z`;

  const params = new URLSearchParams({
    select: 'event_type,page_slug',
    'created_at': `gte.${sinceISO}`,
    order: 'created_at.asc',
    limit: '10000',
  });
  params.append('created_at', `lte.${untilISO}`);

  const headers = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
  };

  const response = await fetch(`${supabaseUrl}/rest/v1/funnel_events?${params}`, { headers });
  if (!response.ok) throw new Error(`Supabase error: ${response.status}`);

  const events = await response.json();

  let free_group_joins = 0;
  let applications = 0;
  let calls_booked = 0;

  for (const e of events) {
    if (e.event_type === 'page_view') {
      // Calls booked = landed on /thanks confirmation page
      if (e.page_slug === 'thanks' || e.page_slug === 'thank-you') {
        calls_booked++;
      }
    } else if (e.event_type === 'form_submit') {
      // Free group joins = opt-ins on /swipe
      if (e.page_slug === 'swipe' || e.page_slug === 'swipe-page') {
        free_group_joins++;
      }
      // Applications = form submit on /apply
      if (e.page_slug === 'application') {
        applications++;
      }
    }
  }

  return { free_group_joins, applications, calls_booked };
}

async function fetchChatStarts(dateStr) {
  const apiKey = process.env.SENDBLUE_API_KEY;
  const apiSecret = process.env.SENDBLUE_API_SECRET;
  if (!apiKey || !apiSecret) throw new Error('SENDBLUE_API_KEY or SENDBLUE_API_SECRET not configured');

  const headers = {
    'sb-api-key-id': apiKey,
    'sb-api-secret-key': apiSecret,
    'Content-Type': 'application/json',
  };

  // Fetch messages from yesterday, paginating to get all
  // A "chat start" = first message from a unique phone number that day
  const seenNumbers = new Set();
  let offset = 0;
  const pageSize = 100;

  while (true) {
    const params = new URLSearchParams({
      limit: String(pageSize),
      offset: String(offset),
    });

    const response = await fetch(`${SENDBLUE_URL}/api/v2/messages?${params}`, { headers });
    const data = await response.json();

    if (!response.ok || data.status === 'ERROR') {
      throw new Error(data.message || 'Sendblue API error');
    }

    const messages = data.data || [];
    if (messages.length === 0) break;

    let foundYesterday = false;
    let pastYesterday = false;

    for (const msg of messages) {
      const msgDate = (msg.date_sent || msg.date_created || '').slice(0, 10);

      if (msgDate === dateStr) {
        foundYesterday = true;
        // Count unique phone numbers that sent messages (inbound)
        if (msg.was_downgraded !== undefined ? !msg.is_outbound : msg.from_number) {
          const number = msg.from_number || msg.number;
          if (number) seenNumbers.add(number);
        }
      } else if (msgDate < dateStr) {
        pastYesterday = true;
        break;
      }
    }

    // If we've gone past yesterday's messages, stop
    if (pastYesterday) break;
    // If we got fewer messages than page size, we're done
    if (messages.length < pageSize) break;

    offset += pageSize;
    // Safety cap
    if (offset >= 2000) break;
  }

  return seenNumbers.size;
}
