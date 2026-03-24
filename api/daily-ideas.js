// api/daily-ideas.js — Daily content idea generator
// Pulls competitor trends + trending news → GPT → 10 content ideas
// GET           → returns today's ideas (or most recent)
// GET ?generate → forces fresh generation
// Called by Vercel cron daily at 4am PT

const SUPABASE_URL   = process.env.SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const sbHeaders = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

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

// ── 1. Get top competitor posts from last 7 days ───────────────────
async function getCompetitorTrends() {
  const since = new Date();
  since.setDate(since.getDate() - 7);

  // Get all active creators except Dan
  const creators = await sbGet('ig_creators', 'is_active=eq.true&username=neq.thedanharrison&select=id,username');
  if (!creators.length) return { posts: [], creators: [] };

  const creatorIds = creators.map(c => c.id);
  const creatorMap = Object.fromEntries(creators.map(c => [c.id, c.username]));

  // Get top posts from these creators in the last 7 days
  const posts = await sbGet(
    'ig_posts',
    `creator_id=in.(${creatorIds.join(',')})&posted_at=gte.${since.toISOString()}&is_analyzed=eq.true&order=likes.desc.nullslast&limit=20&select=caption,likes,comments,views,post_type,hook_framework,hook_structure,content_structure,visual_format,topic,topic_tag,creator_id`
  );

  // Attach creator names
  const enriched = posts.map(p => ({
    ...p,
    creator: creatorMap[p.creator_id] || 'unknown',
  }));

  return { posts: enriched, creators: creators.map(c => c.username) };
}

// ── 2. Get trending topics via web search ──────────────────────────
async function getTrendingTopics() {
  // Use OpenAI to get current trends relevant to Dan's niche
  // This acts as a "trend radar" without needing a separate news API
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
        {
          role: 'system',
          content: 'You are a trend analyst specializing in coaching, online business, Skool communities, AI tools, and creator economy. Return current trends and newsworthy angles.'
        },
        {
          role: 'user',
          content: `Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.

List 8 trending topics, news events, or cultural moments RIGHT NOW that a coaching/online business creator could make content about. Focus on:
- AI tools and updates (Claude, ChatGPT, automation)
- Skool platform news or community trends
- Social media algorithm changes (Instagram, YouTube, TikTok)
- Online business / coaching industry shifts
- Cultural moments or news that coaches could riff on
- Creator economy developments

For each, include the topic, why it's trending, and a content angle.

Return JSON: { "trends": [{ "topic": "...", "why": "...", "angle": "..." }] }`
        },
      ],
      temperature: 0.9,
      max_tokens: 1500,
    }),
  });

  if (!res.ok) {
    console.warn('[daily-ideas] Trend fetch failed:', res.status);
    return [];
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) return [];

  try {
    const parsed = JSON.parse(content);
    return parsed.trends || [];
  } catch {
    return [];
  }
}

// ── 3. Get Dan's own top performers for pattern matching ───────────
async function getDanTopPosts() {
  const creators = await sbGet('ig_creators', 'username=eq.thedanharrison&limit=1');
  if (!creators.length) return [];

  const posts = await sbGet(
    'ig_posts',
    `creator_id=eq.${creators[0].id}&is_analyzed=eq.true&order=likes.desc.nullslast&limit=10&select=caption,likes,comments,views,hook_structure,content_structure,topic,visual_format`
  );
  return posts;
}

// ── 4. Generate ideas with GPT ─────────────────────────────────────
async function generateIdeas(competitorPosts, trends, danTopPosts) {
  const competitorSummary = competitorPosts.slice(0, 15).map((p, i) =>
    `${i + 1}. @${p.creator} (${p.likes} likes) — Hook: "${(p.hook_framework || '').slice(0, 100)}" | Type: ${p.hook_structure || '?'} | Topic: ${p.topic || '?'} | Format: ${p.visual_format || p.post_type || '?'}`
  ).join('\n');

  const trendSummary = trends.map((t, i) =>
    `${i + 1}. ${t.topic} — ${t.why} → Angle: ${t.angle}`
  ).join('\n');

  const danSummary = danTopPosts.map((p, i) =>
    `${i + 1}. (${p.likes} likes) Hook type: ${p.hook_structure || '?'} | Topic: ${p.topic || '?'} | Format: ${p.visual_format || '?'}`
  ).join('\n');

  const systemPrompt = `You are Dan Harrison's content strategist. Dan runs Lifestyle Founders Group (LFG) — helping coaches build $30-50K/month Skool businesses working 4 days/week.

Dan's voice: Frank Kern meets Pete Holmes. Chill, witty, grounded. Anti-bro marketing. Short punchy sentences. Real numbers not hype. Blends spirituality, psychology, comedy, and marketing.

Dan's audience: Coaches/consultants aged 35-52, making $5-40K/month, tired of launching/chasing/hustling. Want simple systems, not complexity.

Dan's platforms: YouTube (long-form 8-15 min), Instagram (Reels + Carousels), TikTok (repurposed shorts).

Dan's key topics: Skool, AI for coaches, Close By Chat (DM selling), anti-bro marketing, 4-day work week, simple offers, community-led growth.`;

  const userPrompt = `Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.

## COMPETITOR TRENDS (top posts this week)
${competitorSummary || 'No competitor data available'}

## TRENDING TOPICS & NEWS
${trendSummary || 'No trends available'}

## DAN'S TOP PERFORMERS (what already works for him)
${danSummary || 'No historical data yet'}

---

Generate exactly 10 content ideas for Dan to film. Mix of:
- 3-4 ideas inspired by competitor trends (put your own spin, don't copy)
- 3-4 ideas riding trending topics/news (timely hooks)
- 2-3 "evergreen bangers" based on Dan's proven formats

For each idea, provide:
1. title — punchy, clickable
2. hook — the exact first sentence Dan would say or put on screen
3. platform — "youtube" or "instagram" or "both"
4. format — "talking-head reel", "carousel", "long-form", "b-roll reel", "screen-share tutorial"
5. angle — 1-2 sentence explanation of why this will hit
6. source — "competitor" or "trending" or "evergreen"
7. urgency — "today" (time-sensitive), "this-week", or "anytime"

Return valid JSON:
{
  "date": "${new Date().toISOString().slice(0, 10)}",
  "summary": "2-3 sentence overview of today's content landscape and what to prioritize",
  "ideas": [
    {
      "rank": 1,
      "title": "...",
      "hook": "...",
      "platform": "...",
      "format": "...",
      "angle": "...",
      "source": "...",
      "urgency": "..."
    }
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
      temperature: 0.85,
      max_tokens: 3000,
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

// ── Handler ────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const generate = req.query.generate !== undefined;

    // Return existing ideas if not forcing regeneration
    if (!generate) {
      const existing = await sbGet(
        'daily_content_ideas',
        `order=run_date.desc&limit=1`
      );
      if (existing.length > 0) {
        return res.json(existing[0]);
      }
    }

    // Generate fresh ideas
    const [{ posts: competitorPosts, creators }, trends, danTopPosts] = await Promise.all([
      getCompetitorTrends(),
      getTrendingTopics(),
      getDanTopPosts(),
    ]);

    const ideas = await generateIdeas(competitorPosts, trends, danTopPosts);

    // Store in Supabase
    const sources = {
      competitors: creators,
      competitorPostCount: competitorPosts.length,
      trendCount: trends.length,
      danPostCount: danTopPosts.length,
      trends: trends.map(t => t.topic),
    };

    await sbUpsert('daily_content_ideas', 'run_date', [{
      run_date: today,
      ideas,
      sources,
    }]);

    return res.json({ run_date: today, ideas, sources });
  } catch (err) {
    console.error('[daily-ideas]', err);
    return res.status(500).json({ error: err.message });
  }
}
