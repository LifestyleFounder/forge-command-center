// api/analyze-posts.js — GPT-powered post analysis for unanalyzed ig_posts
// GET → analyzes up to 5 unanalyzed posts, returns { success, analyzed, remaining }

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const sbHeaders = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation',
};

const BATCH_SIZE = 5;

// ── Supabase helpers ────────────────────────────────────────────────
async function sbGet(table, query = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: sbHeaders });
  if (!res.ok) throw new Error(`Supabase GET ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function sbPatch(table, query, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: 'PATCH', headers: sbHeaders, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase PATCH ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

// ── GPT analysis ────────────────────────────────────────────────────
async function analyzePost(post) {
  const caption = (post.caption || '').substring(0, 1500);
  if (!caption.trim()) {
    return { is_analyzed: true, analyzed_at: new Date().toISOString() };
  }

  const prompt = `Analyze this Instagram post caption for a competitive content analysis tool.

Caption:
"""
${caption}
"""

Post type: ${post.post_type || 'unknown'}

Return a JSON object with these fields (use short, lowercase values):
- hook_framework: The specific hook used in the first 1-2 sentences (quote it exactly, max 100 chars)
- hook_structure: Category of hook — one of: curiosity, pain, authority, social-proof, contrarian, education, transformation, storytelling
- spoken_hook: If this is a video/reel, what would be said first (max 80 chars). Empty string if not applicable.
- text_hook: The text overlay hook if visible from caption context (max 80 chars). Empty string if unclear.
- visual_hook: Description of likely visual hook based on caption (max 60 chars)
- visual_format: One of: talking-head, b-roll, text-on-screen, carousel, photo, mixed
- content_structure: One of: story, list, tutorial, rant, testimonial, behind-the-scenes, q-and-a, myth-busting, hot-take
- topic: Main topic in 2-4 words
- topic_tag: Single-word topic tag (e.g., mindset, sales, marketing, fitness, relationships)
- topic_summary: 1-2 sentence summary of the post's main point
- call_to_action: The CTA if present (max 80 chars). Empty string if none.

Return ONLY valid JSON, no markdown fences.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 500,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI error (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const raw = (data.choices?.[0]?.message?.content || '').trim();

  try {
    const parsed = JSON.parse(raw);
    return {
      hook_framework: (parsed.hook_framework || '').substring(0, 200),
      hook_structure: (parsed.hook_structure || '').substring(0, 50),
      spoken_hook: (parsed.spoken_hook || '').substring(0, 200),
      text_hook: (parsed.text_hook || '').substring(0, 200),
      visual_hook: (parsed.visual_hook || '').substring(0, 200),
      visual_format: (parsed.visual_format || '').substring(0, 50),
      content_structure: (parsed.content_structure || '').substring(0, 50),
      topic: (parsed.topic || '').substring(0, 100),
      topic_tag: (parsed.topic_tag || '').substring(0, 50),
      topic_summary: (parsed.topic_summary || '').substring(0, 500),
      call_to_action: (parsed.call_to_action || '').substring(0, 200),
      is_analyzed: true,
      analyzed_at: new Date().toISOString(),
    };
  } catch {
    console.warn('[analyze-posts] Failed to parse GPT response for post', post.id, raw.slice(0, 100));
    return { is_analyzed: true, analyzed_at: new Date().toISOString() };
  }
}

// ── Main handler ────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_KEY not configured' });
  }
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
  }

  try {
    // Fetch unanalyzed posts (is_analyzed is null or false)
    const unanalyzed = await sbGet(
      'ig_posts',
      `or=(is_analyzed.is.null,is_analyzed.eq.false)&select=id,caption,post_type&order=posted_at.desc&limit=${BATCH_SIZE}`
    );

    if (unanalyzed.length === 0) {
      return res.status(200).json({ success: true, analyzed: 0, remaining: 0 });
    }

    // Count total remaining (including this batch)
    const allUnanalyzed = await sbGet(
      'ig_posts',
      'or=(is_analyzed.is.null,is_analyzed.eq.false)&select=id&limit=1000'
    );
    const totalRemaining = allUnanalyzed.length;

    // Analyze in parallel
    const results = await Promise.allSettled(
      unanalyzed.map(post => analyzePost(post))
    );

    // Write results back to Supabase
    let analyzedCount = 0;
    for (let i = 0; i < unanalyzed.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled' && result.value) {
        try {
          await sbPatch('ig_posts', `id=eq.${unanalyzed[i].id}`, result.value);
          analyzedCount++;
        } catch (err) {
          console.error(`[analyze-posts] Failed to update post ${unanalyzed[i].id}:`, err.message);
        }
      } else if (result.status === 'rejected') {
        console.error(`[analyze-posts] Analysis failed for post ${unanalyzed[i].id}:`, result.reason?.message);
      }
    }

    return res.status(200).json({
      success: true,
      analyzed: analyzedCount,
      remaining: totalRemaining - analyzedCount,
    });
  } catch (err) {
    console.error('[analyze-posts] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
