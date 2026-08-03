CREATE TABLE public.welcome_room_visits (
  wallet text PRIMARY KEY,
  last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  visit_count integer NOT NULL DEFAULT 1,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT ALL ON public.welcome_room_visits TO service_role;

ALTER TABLE public.welcome_room_visits ENABLE ROW LEVEL SECURITY;