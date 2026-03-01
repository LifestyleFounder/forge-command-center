-- funnel_events — tracks page views and form submissions from swipe pages
-- Run this in Supabase SQL Editor for project: nzppfxttbqrgwjofxqfm

CREATE TABLE funnel_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  page_slug text NOT NULL,
  event_type text NOT NULL,
  visitor_id text,
  referrer text,
  created_at timestamptz DEFAULT now()
);

-- Index for the stats API query (group by day + event_type)
CREATE INDEX idx_funnel_events_created ON funnel_events (created_at DESC);
CREATE INDEX idx_funnel_events_type ON funnel_events (event_type);

-- RLS: service_role can do everything, anon has no access
ALTER TABLE funnel_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON funnel_events FOR ALL USING (true);
