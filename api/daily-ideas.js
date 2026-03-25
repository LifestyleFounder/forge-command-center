// api/daily-ideas.js — Daily content idea generator
// Pulls REAL competitor posts + REAL news articles
// Evaluates using 8 Viral Content Archetypes (from daily-content-researcher skill)
// Every idea references a specific real source
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

// ── 1. Real competitor posts from Supabase ─────────────────────────
async function getCompetitorPosts() {
  const since = new Date();
  since.setDate(since.getDate() - 7);

  const creators = await sbGet('ig_creators', 'is_active=eq.true&username=neq.thedanharrison&select=id,username');
  if (!creators.length) return { posts: [], creators: [] };

  const creatorIds = creators.map(c => c.id);
  const creatorMap = Object.fromEntries(creators.map(c => [c.id, c.username]));

  const posts = await sbGet(
    'ig_posts',
    `creator_id=in.(${creatorIds.join(',')})&posted_at=gte.${since.toISOString()}&is_analyzed=eq.true&order=likes.desc.nullslast&limit=25&select=shortcode,caption,likes,comments,views,post_type,hook_framework,hook_structure,content_structure,visual_format,topic,topic_tag,creator_id,posted_at`
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
  // Queries aligned with the 8 Viral Content Archetypes
  const queries = [
    // Archetype 2: Breaking product news
    'AI tool launch OR release coaching creators',
    'Skool platform update OR feature',
    // Archetype 6: New capability
    'ChatGPT OR Claude OR Gemini new feature update',
    'Instagram OR YouTube algorithm change creators',
    // Archetype 7: Industry shock
    'online coaching industry news',
    'creator economy subscription community',
    // Broader niche
    'AI automation small business coaches',
    'social media marketing coaches 2026',
  ];

  const allArticles = [];

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

  // Deduplicate by title, sort by date, take top 20
  const seen = new Set();
  const unique = allArticles.filter(a => {
    const key = a.title.toLowerCase().slice(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  unique.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  return unique.slice(0, 20);
}

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

  return items.slice(0, 4);
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

// ── 3. GPT analyzes real data using 8 Viral Content Archetypes ─────
async function generateIdeas(competitorPosts, articles) {
  // Build competitor context with real URLs
  const competitorContext = competitorPosts.slice(0, 20).map((p, i) => {
    const caption = (p.caption || '').slice(0, 150).replace(/\n/g, ' ');
    return `[C${i + 1}] @${p.creator} | ${p.likes} likes, ${p.comments} comments, ${p.views || 0} views | ${p.post_type}
  Hook type: ${p.hook_structure || '?'} | Visual: ${p.visual_format || '?'} | Topic: ${p.topic || '?'}
  Hook: "${(p.hook_framework || '').slice(0, 150)}"
  Caption: "${caption}"
  URL: ${p.url || 'n/a'}
  Posted: ${p.posted_at ? new Date(p.posted_at).toLocaleDateString() : '?'}`;
  }).join('\n\n');

  // Build news context with real URLs
  const newsContext = articles.map((a, i) =>
    `[N${i + 1}] "${a.title}"
  Publication: ${a.source}
  URL: ${a.url}
  Published: ${a.pubDate ? new Date(a.pubDate).toLocaleDateString() : 'today'}`
  ).join('\n\n');

  const systemPrompt = `You are Dan Harrison's content strategist. You analyze REAL competitor posts and REAL news articles to generate content ideas.

## WHO DAN IS
Dan runs Lifestyle Founders Group (LFG) — helping coaches build $30-50K/month Skool businesses working 4 days/week. 3x Skool Games winner. $25M+ career sales.

Voice: Frank Kern meets Pete Holmes. Chill, witty, grounded. Anti-bro marketing. Short punchy sentences. Real numbers not hype.

Audience: Coaches/consultants aged 35-52, making $5-40K/month, tired of launching/chasing/hustling. Want simple systems.

Platforms: YouTube (long-form 8-15 min), Instagram (Reels + Carousels), TikTok (repurposed shorts).

Key topics: Skool, AI for coaches, Close By Chat (DM selling), anti-bro marketing, 4-day work week, simple offers, community-led growth.

## 8 VIRAL CONTENT ARCHETYPES (use these to evaluate every idea)

1. "Someone Built X with Y" (Proof of Magic) — Show a real result, build, or transformation
2. "X Just Dropped Y" (Breaking Product News) — New tool, feature, or platform update
3. "Free Tool That Does X" (Secret Reveal) — Free resource most people don't know about
4. "You're Doing X Wrong" (Contrarian Correction) — Challenge common advice in the coaching space
5. "X vs Y" (Comparison/Battle) — Compare tools, methods, or approaches
6. "X Can Now Do Y" (New Capability) — New feature that changes what's possible
7. "This Changes Everything" (Industry Shock) — Major shift coaches need to know about
8. Entertaining Automation Demo (Personality + Tech) — Show an automation or AI workflow with personality

## EVALUATION CRITERIA (from daily-content-researcher)

For each potential idea, evaluate:
- **TAM:** Does this appeal broadly? (70% casual viewers, 30% serious coaches)
- **Demo-ability:** Can Dan SHOW this on screen? Tools, workflows, results > opinions
- **Hook potential:** Does it map to a proven hook pattern?
- **Timeliness:** Is this fresh? Breaking > this week > evergreen

CRITICAL RULES:
- Every idea MUST reference a specific source from the data below using its ID tag (e.g. [C3], [N7])
- For competitor-inspired ideas: cite the specific post, creator, and what they did that sparked the idea
- For news-inspired ideas: cite the specific article title, publication, and URL
- Do NOT make up sources. Only reference items from the data provided.
- Do NOT use Dan's own content as a source. All ideas come from competitor posts or news.
- Use the EXACT URLs from the data — do not generate or modify URLs.`;

  const userPrompt = `Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.

═══ COMPETITOR POSTS (last 7 days, by engagement) ═══
${competitorContext || 'No competitor posts scraped this week. Focus on news sources.'}

═══ NEWS ARTICLES (live from Google News today) ═══
${newsContext || 'No news articles found. Focus on competitor data.'}

───────────────────────────────────────

Analyze ALL the sources above. For each, ask:
1. Which archetype does it fit? (if none, skip it)
2. How would Dan put his unique spin on this?
3. What's the hook?

Then generate exactly 10 content ideas ranked by how good the opportunity is. Each idea MUST be inspired by a specific source above.

For each idea:
1. title — punchy, Dan's voice
2. hook — exact opening line Dan would say or put on screen
3. platform — "youtube" or "instagram" or "both"
4. format — "talking-head reel", "carousel", "long-form", "b-roll reel", "screen-share tutorial"
5. archetype — which of the 8 archetypes this fits (number + name)
6. angle — 1-2 sentences: why this hits + how Dan makes it his own
7. source — "competitor" or "news"
8. urgency — "today" (breaking/time-sensitive), "this-week", or "anytime"
9. reference — what specifically inspired this: the creator + what they posted, or the article title + publication
10. referenceId — the ID tag (e.g. "C3" or "N7")
11. referenceUrl — the EXACT URL from the source data above

Return valid JSON:
{
  "date": "${new Date().toISOString().slice(0, 10)}",
  "summary": "2-3 sentences: what's happening today in the data, what Dan should prioritize and why",
  "ideas": [
    {
      "rank": 1,
      "title": "...",
      "hook": "...",
      "platform": "...",
      "format": "...",
      "archetype": "...",
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
    const [{ posts: competitorPosts, creators }, articles] = await Promise.all([
      getCompetitorPosts(),
      getNewsArticles(),
    ]);

    const ideas = await generateIdeas(competitorPosts, articles);

    // Store with full source data for audit
    const sources = {
      competitors: creators,
      competitorPosts: competitorPosts.slice(0, 20).map(p => ({
        creator: p.creator,
        topic: p.topic,
        likes: p.likes,
        hookType: p.hook_structure,
        url: p.url,
      })),
      articles: articles.map(a => ({
        title: a.title,
        source: a.source,
        url: a.url,
      })),
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
