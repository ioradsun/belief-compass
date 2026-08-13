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
