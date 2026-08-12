CREATE TABLE public.forge_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by text,
  request text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('FAST','DEBATE','CRITICAL')),
  status text NOT NULL DEFAULT 'DRAFT',
  current_phase text,
  builder_model text NOT NULL,
  challenger_model text NOT NULL,
  escalation_model text NOT NULL,
  verification_profile text,
  plan jsonb,
  plan_locked_at timestamptz,
  branch_name text,
  pr_url text,
  diff_summary jsonb,
  worker_job_id text,
  total_cost_usd numeric NOT NULL DEFAULT 0,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.forge_events (
  id bigserial PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.forge_jobs(id) ON DELETE CASCADE,
  kind text NOT NULL,
  level text NOT NULL DEFAULT 'info' CHECK (level IN ('info','warn','error','success')),
  role text CHECK (role IN ('builder','challenger','escalation','system','human')),
  message text NOT NULL,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX forge_events_job_idx ON public.forge_events (job_id, id);

CREATE TABLE public.forge_objections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.forge_jobs(id) ON DELETE CASCADE,
  round integer NOT NULL DEFAULT 1,
  severity text NOT NULL CHECK (severity IN ('CRITICAL','HIGH','MEDIUM','LOW')),
  title text NOT NULL,
  body text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','maintained','waived')),
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX forge_objections_job_idx ON public.forge_objections (job_id);

CREATE TABLE public.forge_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.forge_jobs(id) ON DELETE CASCADE,
  name text NOT NULL,
  command text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','passed','failed','skipped')),
  started_at timestamptz,
  completed_at timestamptz,
  duration_ms integer,
  output_summary text,
  failure_summary text,
  position integer NOT NULL DEFAULT 0
);
CREATE INDEX forge_checks_job_idx ON public.forge_checks (job_id, position);

CREATE TABLE public.forge_model_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.forge_jobs(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('builder','challenger','escalation')),
  provider text NOT NULL DEFAULT 'openrouter',
  model_id text NOT NULL,
  phase text,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cost_usd numeric NOT NULL DEFAULT 0,
  latency_ms integer,
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX forge_model_runs_job_idx ON public.forge_model_runs (job_id);

GRANT ALL ON public.forge_jobs TO service_role;
GRANT ALL ON public.forge_events TO service_role;
GRANT ALL ON public.forge_objections TO service_role;
GRANT ALL ON public.forge_checks TO service_role;
GRANT ALL ON public.forge_model_runs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.forge_events_id_seq TO service_role;

ALTER TABLE public.forge_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forge_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forge_objections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forge_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forge_model_runs ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER forge_jobs_touch BEFORE UPDATE ON public.forge_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();