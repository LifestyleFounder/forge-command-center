// api/vercel-projects.js — Lists Vercel projects for the Funnels page picker

const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID || null;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!VERCEL_TOKEN) {
    return res.status(200).json({ projects: [], error: 'VERCEL_TOKEN not configured' });
  }

  try {
    let url = 'https://api.vercel.com/v9/projects?limit=100';
    if (VERCEL_TEAM_ID) url += `&teamId=${VERCEL_TEAM_ID}`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${VERCEL_TOKEN}` },
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('[vercel-projects] API error:', text);
      return res.status(200).json({ projects: [], error: 'Vercel API error' });
    }

    const data = await response.json();
    const projects = (data.projects || []).map(p => ({
      id: p.id,
      name: p.name,
      slug: p.name, // project name is typically the slug
      url: p.targets?.production?.url
        ? `https://${p.targets.production.url}`
        : p.alias?.[0]
          ? `https://${p.alias[0]}`
          : null,
      framework: p.framework || null,
      updatedAt: p.updatedAt,
    }));

    // Sort by most recently updated
    projects.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ projects });
  } catch (err) {
    console.error('[vercel-projects] Error:', err.message);
    return res.status(200).json({ projects: [], error: err.message });
  }
}
