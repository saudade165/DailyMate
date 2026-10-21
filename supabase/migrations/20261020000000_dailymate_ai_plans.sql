-- DailyMate Plus: subscription status and AI request metering.
-- Applied to the DailyMate Supabase project. The AI function itself is not deployed yet (see supabase/README.md).
--
-- Rules enforced here, on the server:
--   * Only users with plan = 'plus', an active/trialing status and a current billing period may use AI.
--   * At most 100 AI requests per billing period (current_period_start .. current_period_end).
--   * Users can read their own plan and usage, but can never write them. Only the server
--     (service role: payment webhook, AI function) changes subscriptions and usage.

create table public.subscriptions (
  user_id              uuid primary key references auth.users (id) on delete cascade,
  plan                 text not null default 'free' check (plan in ('free', 'plus')),
  status               text not null default 'active' check (status in ('active', 'trialing', 'past_due', 'canceled', 'incomplete')),
  current_period_start timestamptz,
  current_period_end   timestamptz,
  provider_customer_id text,           -- e.g. Stripe customer id, set by the payment webhook
  updated_at           timestamptz not null default now(),
  check (current_period_end is null or current_period_start is null or current_period_end > current_period_start)
);

create table public.ai_usage (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  period_start timestamptz not null,
  created_at   timestamptz not null default now()
);
create index ai_usage_user_period on public.ai_usage (user_id, period_start);

alter table public.subscriptions enable row level security;
alter table public.ai_usage enable row level security;

create policy "read own subscription" on public.subscriptions for select to authenticated using ((select auth.uid()) = user_id);
create policy "read own ai usage" on public.ai_usage for select to authenticated using ((select auth.uid()) = user_id);
-- No insert/update/delete policies: browsers cannot change plans or usage.
revoke all on public.subscriptions, public.ai_usage from anon;
revoke insert, update, delete on public.subscriptions, public.ai_usage from authenticated;
grant select on public.subscriptions, public.ai_usage to authenticated;

-- Atomically checks the plan and the limit, and records one request if allowed.
-- Locks the subscription row so two parallel requests can't both take the last slot.
create or replace function public.ai_consume_request(p_user uuid, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.subscriptions;
  used int;
  new_id bigint;
begin
  select * into s from public.subscriptions where user_id = p_user for update;
  if not found or s.plan <> 'plus' or s.status not in ('active', 'trialing')
     or s.current_period_start is null or s.current_period_end is null
     or now() < s.current_period_start or now() >= s.current_period_end then
    return jsonb_build_object('allowed', false, 'reason', 'plan_required');
  end if;
  select count(*) into used from public.ai_usage where user_id = p_user and period_start = s.current_period_start;
  if used >= p_limit then
    return jsonb_build_object('allowed', false, 'reason', 'limit_reached', 'used', used, 'limit', p_limit, 'period_end', s.current_period_end);
  end if;
  insert into public.ai_usage (user_id, period_start) values (p_user, s.current_period_start) returning id into new_id;
  return jsonb_build_object('allowed', true, 'usage_id', new_id, 'used', used + 1, 'limit', p_limit, 'period_end', s.current_period_end);
end $$;

-- Gives a request back when the AI call failed, so errors don't eat into the limit.
create or replace function public.ai_refund_request(p_usage_id bigint)
returns void language sql security definer set search_path = '' as $$
  delete from public.ai_usage where id = p_usage_id;
$$;

-- Plan and usage without spending a request.
create or replace function public.ai_status(p_user uuid, p_limit int default 100)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((
    select jsonb_build_object(
      'plan', s.plan,
      'active', s.plan = 'plus' and s.status in ('active', 'trialing') and s.current_period_start is not null
                and s.current_period_end is not null and now() >= s.current_period_start and now() < s.current_period_end,
      'used', (select count(*) from public.ai_usage u where u.user_id = p_user and u.period_start = s.current_period_start),
      'limit', p_limit,
      'period_end', s.current_period_end)
    from public.subscriptions s where s.user_id = p_user),
    jsonb_build_object('plan', 'free', 'active', false, 'used', 0, 'limit', p_limit, 'period_end', null));
$$;

-- Only the server (service role) may call these.
revoke all on function public.ai_consume_request(uuid, int) from public, anon, authenticated;
revoke all on function public.ai_refund_request(bigint) from public, anon, authenticated;
revoke all on function public.ai_status(uuid, int) from public, anon, authenticated;
grant execute on function public.ai_consume_request(uuid, int) to service_role;
grant execute on function public.ai_refund_request(bigint) to service_role;
grant execute on function public.ai_status(uuid, int) to service_role;
