#!/usr/bin/env node
// scripts/archive-posts.js — Local backup of ig_posts from Supabase
// Usage: node scripts/archive-posts.js
// Writes JSON files to data/post-archives/YYYY-MM/{username}.json

const fs = require('fs');
const path = require('path');

// Load env vars from ~/.forge-env if not already set
if (!process.env.SUPABASE_URL) {
  try {
    const envFile = fs.readFileSync(path.join(process.env.HOME, '.forge-env'), 'utf8');
    for (const line of envFile.split('\n')) {
      const match = line.match(/^(\w+)=(.+)$/);
      if (match) process.env[match[1]] = match[2];
    }
  } catch (e) {
    console.error('Could not load ~/.forge-env:', e.message);
    process.exit(1);
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env');
  process.exit(1);
}

const headers = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
};

async function main() {
  console.log('Fetching creators...');
  const creatorsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/ig_creators?is_active=eq.true&select=id,username`,
    { headers }
  );
  const creators = await creatorsRes.json();
  console.log(`Found ${creators.length} active creators`);

  const now = new Date();
  const monthDir = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const archiveDir = path.join(__dirname, '..', 'data', 'post-archives', monthDir);
  fs.mkdirSync(archiveDir, { recursive: true });

  let totalPosts = 0;

  for (const creator of creators) {
    console.log(`  Fetching posts for @${creator.username}...`);
    const postsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/ig_posts?creator_id=eq.${creator.id}&order=posted_at.desc&limit=1000`,
      { headers }
    );
    const posts = await postsRes.json();

    const filePath = path.join(archiveDir, `${creator.username}.json`);
    fs.writeFileSync(filePath, JSON.stringify(posts, null, 2));
    console.log(`  → ${posts.length} posts → ${filePath}`);
    totalPosts += posts.length;
  }

  console.log(`\nDone! Archived ${totalPosts} posts from ${creators.length} creators to ${archiveDir}/`);
}

main().catch(err => {
  console.error('Archive failed:', err);
  process.exit(1);
});
