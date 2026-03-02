-- content_gameplans — stores AI-generated weekly content plans
-- Run once in Supabase SQL Editor (project: wvoxezzypwpkfovrcdyf)

CREATE TABLE content_gameplans (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  week_start date NOT NULL,
  gameplan jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Unique index for upsert on week_start
CREATE UNIQUE INDEX idx_content_gameplans_week ON content_gameplans (week_start);

ALTER TABLE content_gameplans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON content_gameplans FOR ALL USING (true);
