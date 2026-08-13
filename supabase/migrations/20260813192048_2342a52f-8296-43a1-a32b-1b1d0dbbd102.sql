begin;

create table public.forge_discovery (
  id uuid primary key default gen_random_uuid(),
  request text not null,
  mode text not null default 'DEBATE' check (mode in ('FAST','DEBATE','CRITICAL')),
  digest jsonb not null default '{}'::jsonb,
  messages jsonb not null default '[]'::jsonb,
  plan jsonb not null default '{}'::jsonb,
  ready boolean not null default false,
  status text not null default 'active' check (status in ('active','proceeded','abandoned')),
  job_id uuid references public.forge_jobs(id) on delete set null,
  created_by text not null default 'admin',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index forge_discovery_recent_idx on public.forge_discovery (status, created_at desc);

grant all on public.forge_discovery to service_role;

alter table public.forge_discovery enable row level security;

create trigger forge_discovery_touch before update on public.forge_discovery for each row execute function public.touch_updated_at();

commit;