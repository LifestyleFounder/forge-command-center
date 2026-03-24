-- Daily Content Ideas — stores AI-generated content ideas from competitor + trend analysis
-- Run once in Supabase SQL editor

CREATE TABLE IF NOT EXISTS daily_content_ideas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  run_date DATE NOT NULL UNIQUE,
  ideas JSONB NOT NULL,
  sources JSONB,                 -- { competitors: [...], trends: [...], news: [...] }
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast date lookups
CREATE INDEX IF NOT EXISTS idx_daily_ideas_date ON daily_content_ideas (run_date DESC);

-- RLS (service key bypasses, but good practice)
ALTER TABLE daily_content_ideas ENABLE ROW LEVEL SECURITY;
