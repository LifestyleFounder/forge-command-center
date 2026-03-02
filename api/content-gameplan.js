// api/content-gameplan.js — AI-generated weekly content plan
// GET             → returns existing plan for current week
// GET ?refresh=true → regenerates plan from competitor hook data

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const sbHeaders = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

// ── Helpers ─────────────────────────────────────────────────────────
function getWeekStart() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  return monday.toISOString().slice(0, 10);
}

async function sbGet(table, query = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: sbHeaders });
  if (!res.ok) throw new Error(`Supabase GET ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function sbUpsert(table, onConflict, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: { ...sbHeaders, 'Prefer': 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase UPSERT ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

// ── Fetch top analyzed posts for context ────────────────────────────
async function getTopPosts(limit = 30) {
  const rows = await sbGet(
    'ig_posts',
    `is_analyzed=eq.true&order=likes_count.desc.nullslast&limit=${limit}&select=caption,likes_count,comments_count,post_type,hook_framework,hook_structure,content_topic,content_angle,cta_type,creator_username`
  );
  return rows;
}

// ── GPT generation ──────────────────────────────────────────────────
async function generateGameplan(topPosts) {
  const postSummaries = topPosts.map((p, i) =>
    `${i + 1}. @${p.creator_username} (${p.likes_count} likes) — Hook: "${(p.hook_framework || '').slice(0, 80)}" | Structure: ${p.hook_structure || '?'} | Topic: ${p.content_topic || '?'} | Angle: ${p.content_angle || '?'}`
  ).join('\n');

  const systemPrompt = `You are a content strategist for Dan Harrison, founder of Lifestyle Founders Group (LFG).

Dan's brand: Anti-bro marketing. Systems over hustle. Freedom over flexing. Voice is Frank Kern meets Pete Holmes — chill, witty, grounded. Short punchy sentences. Real numbers, not hype.

Dan's audience: Coaches/consultants aged 35-52, making $5-40K/month, tired of launching and chasing. They want predictable $30-50K+ months with a simple Skool-based model working 4 days/week.

Dan's platforms: YouTube (long-form educational, thought leadership) and Instagram (Reels + Carousels, punchy hooks, transformation stories).

Dan posts Mon-Thu only. Each day needs 1 YouTube idea and 1 Instagram idea.`;

  const userPrompt = `Here are the top ${topPosts.length} performing competitor posts (by likes) with their hook analysis:

${postSummaries}

Generate a weekly content plan (Mon-Thu) for Dan. For each day, provide:
1. One YouTube video idea (long-form, 8-15 min)
2. One Instagram post idea (Reel or Carousel)

Each idea should have: title, hook (first line/sentence), format, and rationale (1 sentence explaining why this will work based on competitor data).

Also write a 2-sentence weekly theme/summary at the top.

Return valid JSON:
{
  "summary": "...",
  "days": [
    {
      "day": "Monday",
      "youtube": { "title": "...", "hook": "...", "format": "...", "rationale": "..." },
      "instagram": { "title": "...", "hook": "...", "format": "Reel|Carousel", "rationale": "..." }
    },
    ...
  ]
}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.8,
      max_tokens: 2000,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error: ${res.status} ${err}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty response from OpenAI');

  return JSON.parse(content);
}

// ── Handler ─────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const weekStart = getWeekStart();
    const refresh = req.query.refresh === 'true';

    // Check for existing plan
    if (!refresh) {
      const existing = await sbGet(
        'content_gameplans',
        `week_start=eq.${weekStart}&limit=1`
      );
      if (existing.length > 0) {
        return res.json({ weekStart, gameplan: existing[0].gameplan });
      }
    }

    // Generate new plan
    const topPosts = await getTopPosts(30);
    if (topPosts.length === 0) {
      return res.status(400).json({ error: 'No analyzed posts available. Run the post analyzer first.' });
    }

    const gameplan = await generateGameplan(topPosts);

    // Upsert into Supabase
    await sbUpsert('content_gameplans', 'week_start', [{
      week_start: weekStart,
      gameplan,
    }]);

    return res.json({ weekStart, gameplan });
  } catch (err) {
    console.error('[content-gameplan]', err);
    return res.status(500).json({ error: err.message });
  }
}
