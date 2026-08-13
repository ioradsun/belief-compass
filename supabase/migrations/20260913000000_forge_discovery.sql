-- Forge Discovery — the pre-job planning session.
--
-- Before a job exists, the business and the AI (CTO) hold an office-hours
-- conversation grounded in a one-time read of the codebase (the digest), until
-- there is a structured brief an engineer can build without guessing. On
-- "Proceed" the brief becomes a normal Forge job; the session records which one.
--
-- State lives here, not on the worker, so a refresh never loses the session.

CREATE TABLE public.forge_discovery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request text NOT NULL,
  mode text NOT NULL DEFAULT 'DEBATE' CHECK (mode IN ('FAST','DEBATE','CRITICAL')),
  -- The one-time repo read that grounds the conversation.
  digest jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The conversation: [{ role: 'ai' | 'you', content, suggestedAnswers? }].
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- The living structured brief.
  plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  ready boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','proceeded','abandoned')),
  job_id uuid REFERENCES public.forge_jobs(id) ON DELETE SET NULL,
  created_by text NOT NULL DEFAULT 'admin',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX forge_discovery_recent_idx ON public.forge_discovery (status, created_at DESC);

GRANT ALL ON public.forge_discovery TO service_role;
ALTER TABLE public.forge_discovery ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER forge_discovery_touch BEFORE UPDATE ON public.forge_discovery
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
