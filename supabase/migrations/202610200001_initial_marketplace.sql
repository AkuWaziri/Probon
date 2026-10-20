-- Probon initial persistent marketplace schema for Supabase.
-- Monetary columns are display/accounting values; the Arc escrow contract is the source of truth for funds.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  wallet_address text unique,
  email text,
  telegram_username text,
  notify_slots_filled boolean not null default true,
  notify_rewards_distributed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_wallet_lowercase check (wallet_address is null or wallet_address = lower(wallet_address))
);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  creator_user_id uuid not null references auth.users(id) on delete restrict,
  creator_wallet text not null,
  brand_name text not null,
  brand_initials text not null default 'P',
  brand_logo_url text,
  category text not null default 'Other',
  title text not null,
  description text not null,
  channel text not null check (channel in ('X / Twitter','TikTok','Telegram','WhatsApp','Video','Blog','Medium','Other')),
  reward_amount numeric(20,6) not null check (reward_amount > 0),
  budget_amount numeric(20,6) not null check (budget_amount > 0),
  platform_fee_amount numeric(20,6) not null check (platform_fee_amount >= 0),
  slots_total integer not null check (slots_total > 0),
  joined_count integer not null default 0 check (joined_count >= 0 and joined_count <= slots_total),
  deadline timestamptz not null,
  status text not null default 'upcoming' check (status in ('upcoming','active','ended','under_review','completed','cancelled')),
  requirements text not null,
  funding_status text not null default 'pending' check (funding_status in ('pending','confirmed','failed','refunded')),
  funding_tx_hash text unique,
  funding_amount numeric(20,6),
  escrow_campaign_id numeric(78,0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaigns_creator_wallet_lowercase check (creator_wallet = lower(creator_wallet)),
  constraint campaigns_budget_covers_rewards check (budget_amount >= reward_amount * slots_total)
);

create table if not exists public.campaign_participations (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete restrict,
  participant_user_id uuid not null references auth.users(id) on delete restrict,
  participant_wallet text not null,
  status text not null default 'joined' check (status in ('joined','submitted','approved','rejected','paid','withdrawn')),
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, participant_user_id),
  constraint participation_wallet_lowercase check (participant_wallet = lower(participant_wallet))
);

create table if not exists public.campaign_submissions (
  id uuid primary key default gen_random_uuid(),
  participation_id uuid not null unique references public.campaign_participations(id) on delete restrict,
  work_url text not null check (work_url ~* '^https?://'),
  promo_url text not null check (promo_url ~* '^https?://'),
  notes text,
  review_status text not null default 'pending' check (review_status in ('pending','approved','rejected')),
  review_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table if not exists public.campaign_payouts (
  id uuid primary key default gen_random_uuid(),
  participation_id uuid not null unique references public.campaign_participations(id) on delete restrict,
  recipient_wallet text not null,
  amount numeric(20,6) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending','submitted','confirmed','failed')),
  tx_hash text unique,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  constraint payout_wallet_lowercase check (recipient_wallet = lower(recipient_wallet))
);

create index if not exists campaigns_discovery_idx on public.campaigns(status, funding_status, deadline);
create index if not exists campaigns_creator_idx on public.campaigns(creator_user_id, created_at desc);
create index if not exists participations_user_idx on public.campaign_participations(participant_user_id, joined_at desc);
create index if not exists submissions_review_idx on public.campaign_submissions(review_status, submitted_at);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists campaigns_set_updated_at on public.campaigns;
create trigger campaigns_set_updated_at before update on public.campaigns for each row execute function public.set_updated_at();
drop trigger if exists participations_set_updated_at on public.campaign_participations;
create trigger participations_set_updated_at before update on public.campaign_participations for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_participations enable row level security;
alter table public.campaign_submissions enable row level security;
alter table public.campaign_payouts enable row level security;

drop policy if exists "profiles read own" on public.profiles;
create policy "profiles read own" on public.profiles for select to authenticated using (id = (select auth.uid()));
drop policy if exists "profiles insert own" on public.profiles;
create policy "profiles insert own" on public.profiles for insert to authenticated with check (id = (select auth.uid()));
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists "public discover funded campaigns" on public.campaigns;
create policy "public discover funded campaigns" on public.campaigns for select to anon, authenticated using (funding_status = 'confirmed' and status <> 'cancelled');
drop policy if exists "creator read own campaigns" on public.campaigns;
create policy "creator read own campaigns" on public.campaigns for select to authenticated using (creator_user_id = (select auth.uid()));
drop policy if exists "creator create campaign record" on public.campaigns;
create policy "creator create campaign record" on public.campaigns for insert to authenticated with check (
  creator_user_id = (select auth.uid()) and
  creator_wallet = lower(coalesce((select auth.jwt() -> 'user_metadata' ->> 'wallet_address'), ''))
);
drop policy if exists "creator update own campaigns" on public.campaigns;
create policy "creator update own campaigns" on public.campaigns for update to authenticated using (creator_user_id = (select auth.uid())) with check (creator_user_id = (select auth.uid()));

drop policy if exists "participant and creator read joins" on public.campaign_participations;
create policy "participant and creator read joins" on public.campaign_participations for select to authenticated using (
  participant_user_id = (select auth.uid()) or exists (
    select 1 from public.campaigns c where c.id = campaign_id and c.creator_user_id = (select auth.uid())
  )
);
drop policy if exists "participant join eligible campaign" on public.campaign_participations;
create policy "participant join eligible campaign" on public.campaign_participations for insert to authenticated with check (
  participant_user_id = (select auth.uid()) and
  participant_wallet = lower(coalesce((select auth.jwt() -> 'user_metadata' ->> 'wallet_address'), '')) and
  exists (select 1 from public.campaigns c where c.id = campaign_id and c.funding_status = 'confirmed'
    and c.status = 'active' and c.deadline > now() and c.joined_count < c.slots_total)
);

drop policy if exists "participant and creator read submissions" on public.campaign_submissions;
create policy "participant and creator read submissions" on public.campaign_submissions for select to authenticated using (
  exists (select 1 from public.campaign_participations p where p.id = participation_id and p.participant_user_id = (select auth.uid()))
  or exists (select 1 from public.campaign_participations p join public.campaigns c on c.id = p.campaign_id
    where p.id = participation_id and c.creator_user_id = (select auth.uid()))
);
drop policy if exists "participant submit once before deadline" on public.campaign_submissions;
create policy "participant submit once before deadline" on public.campaign_submissions for insert to authenticated with check (
  exists (select 1 from public.campaign_participations p join public.campaigns c on c.id = p.campaign_id
    where p.id = participation_id and p.participant_user_id = (select auth.uid()) and p.status = 'joined'
    and c.status = 'active' and c.deadline > now())
);
drop policy if exists "creator review submissions" on public.campaign_submissions;
create policy "creator review submissions" on public.campaign_submissions for update to authenticated using (
  exists (select 1 from public.campaign_participations p join public.campaigns c on c.id = p.campaign_id
    where p.id = participation_id and c.creator_user_id = (select auth.uid()))
) with check (
  reviewed_by = (select auth.uid()) and exists (
    select 1 from public.campaign_participations p join public.campaigns c on c.id = p.campaign_id
    where p.id = participation_id and c.creator_user_id = (select auth.uid()))
);

drop policy if exists "participant and creator read payouts" on public.campaign_payouts;
create policy "participant and creator read payouts" on public.campaign_payouts for select to authenticated using (
  exists (select 1 from public.campaign_participations p where p.id = participation_id and p.participant_user_id = (select auth.uid()))
  or exists (select 1 from public.campaign_participations p join public.campaigns c on c.id = p.campaign_id
    where p.id = participation_id and c.creator_user_id = (select auth.uid()))
);
-- Intentionally no client write policies for payout rows.

-- Lock the campaign row so concurrent joins cannot exceed the slot count.
create or replace function public.join_campaign(p_campaign_id uuid)
returns public.campaign_participations language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_wallet text := lower(coalesce(auth.jwt() -> 'user_metadata' ->> 'wallet_address', ''));
  v_campaign public.campaigns;
  v_participation public.campaign_participations;
begin
  if v_user_id is null or v_wallet = '' then raise exception 'Wallet authentication required'; end if;
  select * into v_campaign from public.campaigns where id = p_campaign_id for update;
  if not found then raise exception 'Campaign not found'; end if;
  if v_campaign.funding_status <> 'confirmed' or v_campaign.status <> 'active' then raise exception 'Campaign is not open'; end if;
  if v_campaign.deadline <= now() then raise exception 'Campaign deadline has passed'; end if;
  if v_campaign.joined_count >= v_campaign.slots_total then raise exception 'Campaign is full'; end if;
  insert into public.campaign_participations(campaign_id, participant_user_id, participant_wallet)
    values (p_campaign_id, v_user_id, v_wallet) returning * into v_participation;
  update public.campaigns set joined_count = joined_count + 1 where id = p_campaign_id;
  return v_participation;
end;
$$;
revoke all on function public.join_campaign(uuid) from public, anon;
grant execute on function public.join_campaign(uuid) to authenticated;
revoke insert on public.campaign_participations from authenticated;
