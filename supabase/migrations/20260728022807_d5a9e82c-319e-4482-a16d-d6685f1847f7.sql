create table if not exists public.house_predictions (
  wallet text not null,
  onchain_id bigint not null,
  category text,
  predicted_action text check (predicted_action in ('YES','NO','SKIP')),
  confidence numeric not null default 0,
  reasons jsonb not null default '[]'::jsonb,
  no_read_kind text,
  engine_version integer not null default 1,
  created_at timestamptz not null default now(),
  revealed_at timestamptz,
  actual_action text check (actual_action in ('YES','NO','SKIP')),
  outcome text check (outcome in ('correct','miss','unscored')),
  answer_source text,
  primary key (wallet, onchain_id)
);

grant all on public.house_predictions to service_role;

alter table public.house_predictions enable row level security;

create index if not exists house_predictions_wallet_idx
  on public.house_predictions (wallet, created_at desc);
create index if not exists house_predictions_answered_idx
  on public.house_predictions (wallet, category)
  where actual_action is not null;