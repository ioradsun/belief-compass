-- Forge model config — which OpenRouter model plays each role.
--
-- One row per role. Read by forgeGetModelConfig / written by forgeSetModelConfig
-- (both admin-gated, service-role). When a role has no row, the app falls back
-- to the MODEL_REGISTRY default, so this table is purely an override layer.

CREATE TABLE public.forge_model_config (
  role text PRIMARY KEY CHECK (role IN ('builder','challenger','escalation')),
  model_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.forge_model_config TO service_role;
ALTER TABLE public.forge_model_config ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER forge_model_config_touch BEFORE UPDATE ON public.forge_model_config
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Forge autonomous loop — a queue of improvement items, and a settings store.
--
-- Each queued bug / feature / friction item becomes a Forge job whose output is
-- a PULL REQUEST — never a direct deploy. The loop on/off flag lives in
-- forge_settings. A human still approves every merge.

CREATE TABLE public.forge_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL DEFAULT 'bug' CHECK (kind IN ('bug','feature','friction','chore')),
  title text NOT NULL,
  body text,
  source text NOT NULL DEFAULT 'admin',
  priority integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','pr_open','done','rejected')),
  job_id uuid REFERENCES public.forge_jobs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- The driver picks the next item by this order.
CREATE INDEX forge_queue_pick_idx ON public.forge_queue (status, priority DESC, created_at);

CREATE TABLE public.forge_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.forge_queue TO service_role;
GRANT ALL ON public.forge_settings TO service_role;
ALTER TABLE public.forge_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forge_settings ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER forge_queue_touch BEFORE UPDATE ON public.forge_queue
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER forge_settings_touch BEFORE UPDATE ON public.forge_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();