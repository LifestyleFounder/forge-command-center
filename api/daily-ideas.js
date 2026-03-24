// api/daily-ideas.js — Daily content idea generator
// Pulls REAL competitor posts from Supabase + REAL news from Google News RSS
// GPT analyzes actual data and generates ideas with real source links
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

// ── 1. Real competitor posts from Supabase (with IG links) ─────────
async function getCompetitorPosts() {
  const since = new Date();
  since.setDate(since.getDate() - 7);

  const creators = await sbGet('ig_creators', 'is_active=eq.true&username=neq.thedanharrison&select=id,username');
  if (!creators.length) return { posts: [], creators: [] };

  const creatorIds = creators.map(c => c.id);
  const creatorMap = Object.fromEntries(creators.map(c => [c.id, c.username]));

  const posts = await sbGet(
    'ig_posts',
    `creator_id=in.(${creatorIds.join(',')})&posted_at=gte.${since.toISOString()}&is_analyzed=eq.true&order=likes.desc.nullslast&limit=20&select=shortcode,caption,likes,comments,views,post_type,hook_framework,hook_structure,content_structure,visual_format,topic,topic_tag,creator_id,posted_at`
  );

  const enriched = posts.map(p => ({
    ...p,
    creator: creatorMap[p.creator_id] || 'unknown',
    url: p.shortcode ? `https://instagram.com/p/${p.shortcode}` : null,
  }));

  return { posts: enriched, creators: creators.map(c => c.username) };
}

// ── 2. Real news articles from Google News RSS ─────────────────────
async function getNewsArticles() {
  const queries = [
    'online coaching business 2026',
    'Skool community platform',
    'AI tools coaches creators',
    'Instagram algorithm update',
    'YouTube creator economy',
    'coaching industry trends',
  ];

  const allArticles = [];

  // Fetch RSS feeds in parallel
  const feeds = await Promise.allSettled(
    queries.map(async (q) => {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) return [];
      const xml = await res.text();
      return parseRssItems(xml, q);
    })
  );

  for (const result of feeds) {
    if (result.status === 'fulfilled') {
      allArticles.push(...result.value);
    }
  }

  // Deduplicate by title, sort by date, take top 15
  const seen = new Set();
  const unique = allArticles.filter(a => {
    const key = a.title.toLowerCase().slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  unique.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  return unique.slice(0, 15);
}

// Simple XML parser for Google News RSS (no dependencies)
function parseRssItems(xml, query) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link');
    const pubDate = extractTag(block, 'pubDate');
    const source = extractTag(block, 'source');

    if (title && link) {
      items.push({
        title: decodeHtmlEntities(title),
        url: link,
        pubDate: pubDate || '',
        source: source ? decodeHtmlEntities(source) : '',
        query,
      });
    }
  }

  return items.slice(0, 5); // Max 5 per query
}

function extractTag(xml, tag) {
  const regex = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?</${tag}>`, 's');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

// ── 3. Dan's own top performers ────────────────────────────────────
async function getDanTopPosts() {
  const creators = await sbGet('ig_creators', 'username=eq.thedanharrison&limit=1');
  if (!creators.length) return [];

  return sbGet(
    'ig_posts',
    `creator_id=eq.${creators[0].id}&is_analyzed=eq.true&order=likes.desc.nullslast&limit=10&select=shortcode,caption,likes,comments,views,hook_structure,content_structure,topic,visual_format`
  );
}

// ── 4. GPT analyzes REAL data ──────────────────────────────────────
async function generateIdeas(competitorPosts, articles, danTopPosts) {
  // Build competitor context with real URLs
  const competitorContext = competitorPosts.slice(0, 15).map((p, i) => {
    const caption = (p.caption || '').slice(0, 120).replace(/\n/g, ' ');
    return `[C${i + 1}] @${p.creator} | ${p.likes} likes | ${p.post_type} | Hook type: ${p.hook_structure || '?'} | Topic: ${p.topic || '?'}
  Hook: "${(p.hook_framework || '').slice(0, 120)}"
  Caption: "${caption}"
  URL: ${p.url || 'n/a'}
  Posted: ${p.posted_at ? new Date(p.posted_at).toLocaleDateString() : '?'}`;
  }).join('\n\n');

  // Build news context with real URLs
  const newsContext = articles.map((a, i) =>
    `[N${i + 1}] "${a.title}"
  Source: ${a.source}
  URL: ${a.url}
  Published: ${a.pubDate ? new Date(a.pubDate).toLocaleDateString() : 'today'}
  Search topic: ${a.query}`
  ).join('\n\n');

  // Dan's data
  const danContext = danTopPosts.map((p, i) => {
    const url = p.shortcode ? `https://instagram.com/p/${p.shortcode}` : 'n/a';
    return `[D${i + 1}] ${p.likes} likes | Hook: ${p.hook_structure || '?'} | Topic: ${p.topic || '?'} | Format: ${p.visual_format || '?'} | URL: ${url}`;
  }).join('\n');

  const systemPrompt = `You are Dan Harrison's content strategist. Your job is to analyze REAL competitor posts and REAL news articles, then generate content ideas that reference specific sources.

Dan runs Lifestyle Founders Group (LFG) — helping coaches build $30-50K/month Skool businesses working 4 days/week.

Dan's voice: Frank Kern meets Pete Holmes. Chill, witty, grounded. Anti-bro marketing. Short punchy sentences. Real numbers not hype.

Dan's audience: Coaches/consultants aged 35-52, making $5-40K/month, tired of launching/chasing/hustling.

Dan's platforms: YouTube (long-form 8-15 min), Instagram (Reels + Carousels), TikTok (repurposed shorts).

Dan's key topics: Skool, AI for coaches, Close By Chat (DM selling), anti-bro marketing, 4-day work week, simple offers, community-led growth.

CRITICAL RULES:
- Every idea MUST reference a specific source from the data below using its ID tag (e.g. [C3], [N7], [D2])
- For competitor-inspired ideas: cite the specific post and creator
- For trending ideas: cite the specific article title, source publication, and URL
- For evergreen ideas: cite which of Dan's own posts proves the format works
- Do NOT make up sources. Only reference items from the data provided.`;

  const userPrompt = `Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.

═══ REAL COMPETITOR POSTS (last 7 days, sorted by engagement) ═══
${competitorContext || 'No competitor posts scraped this week.'}

═══ REAL NEWS ARTICLES (fetched today from Google News) ═══
${newsContext || 'No news articles found.'}

═══ DAN'S OWN TOP PERFORMERS ═══
${danContext || 'No historical data yet.'}

───────────────────────────────────────

Generate exactly 10 content ideas. Mix:
- 3-4 ideas inspired by specific competitor posts above
- 3-4 ideas riding specific news articles above
- 2-3 evergreen ideas based on Dan's proven formats

For each idea:
1. title — punchy, clickable
2. hook — exact first sentence Dan would say or put on screen
3. platform — "youtube" or "instagram" or "both"
4. format — "talking-head reel", "carousel", "long-form", "b-roll reel", "screen-share tutorial"
5. angle — 1-2 sentences on why this will hit
6. source — "competitor" or "news" or "evergreen"
7. urgency — "today" (time-sensitive), "this-week", or "anytime"
8. reference — the specific source that inspired this: for competitor posts include "@username — [topic/hook summary]", for news include the article title and publication, for evergreen reference Dan's post
9. referenceId — the ID tag from the data above (e.g. "C3", "N7", "D2")
10. referenceUrl — the actual URL of the source post or article from the data above. Use the exact URL provided — do NOT generate or modify URLs.

Return valid JSON:
{
  "date": "${new Date().toISOString().slice(0, 10)}",
  "summary": "2-3 sentence overview of today's content landscape based on what you see in the real data",
  "ideas": [
    {
      "rank": 1,
      "title": "...",
      "hook": "...",
      "platform": "...",
      "format": "...",
      "angle": "...",
      "source": "...",
      "urgency": "...",
      "reference": "...",
      "referenceId": "...",
      "referenceUrl": "..."
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
      temperature: 0.8,
      max_tokens: 4000,
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

    // Gather REAL data in parallel
    const [{ posts: competitorPosts, creators }, articles, danTopPosts] = await Promise.all([
      getCompetitorPosts(),
      getNewsArticles(),
      getDanTopPosts(),
    ]);

    // Generate ideas from real data
    const ideas = await generateIdeas(competitorPosts, articles, danTopPosts);

    // Store in Supabase with full source data
    const sources = {
      competitors: creators,
      competitorPosts: competitorPosts.slice(0, 15).map(p => ({
        creator: p.creator,
        topic: p.topic,
        likes: p.likes,
        url: p.url,
        hookType: p.hook_structure,
      })),
      articles: articles.map(a => ({
        title: a.title,
        source: a.source,
        url: a.url,
        query: a.query,
      })),
      danPostCount: danTopPosts.length,
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
