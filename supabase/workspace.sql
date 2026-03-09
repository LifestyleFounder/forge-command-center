-- Workspace sync tables: folders + docs
-- Run in Supabase SQL Editor (project: nzppfxttbqrgwjofxqfm)

CREATE TABLE workspace_folders (
  id text PRIMARY KEY,
  user_id text NOT NULL DEFAULT 'dan',
  name text NOT NULL,
  parent_id text,
  sort_order int DEFAULT 0,
  type text DEFAULT 'folder',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE workspace_docs (
  id text PRIMARY KEY,
  user_id text NOT NULL DEFAULT 'dan',
  title text DEFAULT 'Untitled',
  folder_id text NOT NULL,
  content jsonb,
  notion_page_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS: allow anon key access (single-user, same as chat tables)
ALTER TABLE workspace_folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all" ON workspace_folders FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE workspace_docs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all" ON workspace_docs FOR ALL USING (true) WITH CHECK (true);
