// api/sendblue-upload.js — Upload voice note to Supabase Storage, return public URL
// POST with multipart form data (audio blob)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = 'voice-notes';

export const config = {
  api: { bodyParser: false },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'SUPABASE_URL or SUPABASE_SERVICE_KEY not configured' });
  }

  try {
    // Read raw body
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    if (buffer.length === 0) return res.status(400).json({ error: 'No audio data received' });
    if (buffer.length > 20 * 1024 * 1024) return res.status(400).json({ error: 'File too large (max 20MB)' });

    // Generate unique filename
    const filename = `voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.m4a`;
    const path = `${filename}`;

    // Upload to Supabase Storage
    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`,
      {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'audio/mp4',
          'x-upsert': 'true',
        },
        body: buffer,
      }
    );

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      // If bucket doesn't exist, create it and retry
      if (err.includes('not found') || err.includes('Bucket')) {
        const createRes = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
        });

        if (!createRes.ok) {
          const createErr = await createRes.text();
          return res.status(500).json({ error: `Failed to create bucket: ${createErr}` });
        }

        // Retry upload
        const retryRes = await fetch(
          `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`,
          {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${SUPABASE_KEY}`,
              'Content-Type': 'audio/mp4',
              'x-upsert': 'true',
            },
            body: buffer,
          }
        );

        if (!retryRes.ok) {
          const retryErr = await retryRes.text();
          return res.status(500).json({ error: `Upload failed: ${retryErr}` });
        }
      } else {
        return res.status(500).json({ error: `Upload failed: ${err}` });
      }
    }

    // Return public URL
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
    return res.status(200).json({ url: publicUrl, filename });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
