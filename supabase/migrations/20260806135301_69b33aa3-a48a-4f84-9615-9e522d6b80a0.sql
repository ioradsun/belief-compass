CREATE TABLE IF NOT EXISTS public.follows (
  follower  text        NOT NULL,
  followed  text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower, followed),
  CONSTRAINT follows_not_self CHECK (follower <> followed)
);

GRANT ALL ON public.follows TO service_role;

ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS follows_follower_idx ON public.follows (follower);
CREATE INDEX IF NOT EXISTS follows_followed_idx ON public.follows (followed);