-- Goals (extends the existing, so far unused goals table), achievements, and
-- delivery status for admin e-mails. Nothing is dropped; existing rows keep working.

-- ---- Goals ------------------------------------------------------------------------------
-- Existing columns are reused: title, notes, target_date (= deadline), done, done_at (= completed at),
-- plus the usual sync columns, trigger (last write wins) and RLS policies (own rows only).

alter table public.goals
  add column kind            text not null default 'custom'
                             check (kind in ('tasks', 'active_days', 'streak', 'list', 'custom')),
  add column target          integer not null default 1 check (target between 1 and 10000),
  add column start_date      date,
  add column status          text not null default 'active' check (status in ('active', 'paused', 'completed')),
  add column priority        text not null default 'any' check (priority in ('any', 'high', 'medium', 'low')),
  add column period          text not null default 'day' check (period in ('day', 'week')),
  add column list_id         text check (char_length(list_id) <= 64),
  add column manual_progress integer not null default 0 check (manual_progress between 0 and 10000),
  add column achieved        integer check (achieved between 0 and 1000000),
  add check (target_date is null or start_date is null or target_date >= start_date);

-- Deleted goals keep only what sync needs (extends the existing scrub trigger's goal branch).
create or replace function private.scrub_tombstone() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.deleted_at is null then return new; end if;
  case tg_table_name
    when 'tasks' then
      new.title := '-'; new.notes := ''; new.time := null; new.repeat := null; new.next_id := null;
    when 'lists' then
      new.name := '-'; new.items := '[]';
    when 'reminders' then
      new.title := '-'; new.notes := ''; new.task_id := null; new.repeat := null; new.snoozed_until := null;
    when 'goals' then
      new.title := '-'; new.notes := ''; new.list_id := null;
  end case;
  return new;
end $$;

-- ---- Achievements ---------------------------------------------------------------------------
-- {"first_task": "2026-10-21T15:00:00Z", ...}. Only ever grows: the server merges what a device
-- sends with what it already has (keeping the earliest date), so a device can't remove one.

alter table public.profiles
  add column achievements jsonb not null default '{}'
  check (jsonb_typeof(achievements) = 'object' and pg_column_size(achievements) < 16384);

create function public.merge_achievements(p_achievements jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); merged jsonb; k text; v text;
begin
  if uid is null or not public.account_active() then raise exception 'not signed in' using errcode = '28000'; end if;
  if jsonb_typeof(p_achievements) <> 'object' then raise exception 'invalid achievements' using errcode = '22023'; end if;
  select achievements into merged from public.profiles where id = uid for update;
  for k, v in select key, value #>> '{}' from jsonb_each(p_achievements) limit 200 loop
    continue when k !~ '^[a-z0-9_]{1,40}$' or v is null or v !~ '^\d{4}-\d{2}-\d{2}';
    begin
      perform v::timestamptz;
    exception when others then continue;
    end;
    if not merged ? k or (merged ->> k)::timestamptz > v::timestamptz then
      merged := merged || jsonb_build_object(k, v);
    end if;
  end loop;
  update public.profiles set achievements = merged where id = uid;
  return merged;
end $$;
revoke all on function public.merge_achievements(jsonb) from public, anon;
grant execute on function public.merge_achievements(jsonb) to authenticated;

-- ---- Admin e-mails: delivery status from Resend ------------------------------------------------

alter table public.admin_email_queue
  add column delivery_status     text check (char_length(delivery_status) <= 40),
  add column delivery_checked_at timestamptz;

-- Sent e-mails whose final delivery status isn't known yet (checked at most every 5 minutes, for 3 days).
create function public.admin_mail_delivery_pending(p_limit int default 20)
returns table (id bigint, provider_id text)
language sql security definer set search_path = '' as $$
  select q.id, q.provider_id from public.admin_email_queue q
   where q.status = 'sent' and q.provider_id is not null and q.sent_at > now() - interval '3 days'
     and coalesce(q.delivery_status, '') not in ('delivered', 'bounced', 'complained', 'opened', 'clicked', 'failed', 'canceled')
     and (q.delivery_checked_at is null or q.delivery_checked_at < now() - interval '5 minutes')
   order by q.id limit p_limit;
$$;

create function public.admin_mail_set_delivery(p_id bigint, p_status text) returns void
language sql security definer set search_path = '' as $$
  update public.admin_email_queue set delivery_status = left(p_status, 40), delivery_checked_at = now() where id = p_id;
$$;

create or replace function private.admin_mail_has_work() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admin_email_queue
                  where (status = 'pending' and next_attempt_at <= now()) or (status = 'sending' and locked_until < now()))
      or exists (select 1 from public.admin_mail_delivery_pending(1));
$$;

drop function public.admin_email_log(int);
create function public.admin_email_log(p_limit int default 30)
returns table (id bigint, kind text, status text, attempts int, last_error text, created_at timestamptz, sent_at timestamptz,
               user_email text, delivery_status text, delivery_checked_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query select q.id, q.kind, q.status, q.attempts, q.last_error, q.created_at, q.sent_at, u.email::text,
                      q.delivery_status, q.delivery_checked_at
                 from public.admin_email_queue q left join auth.users u on u.id = q.user_id
                order by q.id desc limit least(greatest(p_limit, 1), 100);
end $$;

-- Goals in the admin usage numbers (counts only).
do $$
declare def text;
begin
  def := pg_get_functiondef('public.admin_dashboard(date, date, text)'::regprocedure);
  def := replace(def, $r$'reminders',      (select count(*) from public.reminders where deleted_at is null),$r$,
    $r$'reminders',      (select count(*) from public.reminders where deleted_at is null),
      'goals',          (select count(*) from public.goals where deleted_at is null),
      'goalsCompleted', (select count(*) from public.goals where deleted_at is null and status = 'completed'),
      'usersWithGoals', (select count(distinct user_id) from public.goals where deleted_at is null),$r$);
  if position('goalsCompleted' in def) = 0 then raise exception 'admin_dashboard was not updated'; end if;
  execute def;
end $$;

-- ---- Permissions ---------------------------------------------------------------------------

revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function public.admin_mail_delivery_pending(int) from public, anon, authenticated;
revoke all on function public.admin_mail_set_delivery(bigint, text) from public, anon, authenticated;
grant execute on function public.admin_mail_delivery_pending(int) to service_role;
grant execute on function public.admin_mail_set_delivery(bigint, text) to service_role;
revoke all on function public.admin_email_log(int) from public, anon;
grant execute on function public.admin_email_log(int) to authenticated;
