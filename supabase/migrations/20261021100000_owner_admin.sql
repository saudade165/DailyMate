-- Owner-only administration, activity statistics, user management and
-- e-mail notifications about new registrations.
--
-- * The only administrator is the owner account. Its address is NOT stored in this
--   public repository: it lives in private.app_settings ('owner_email'), which is set
--   with SQL in the dashboard (see supabase/README.md). public.is_admin() is true only
--   for a signed-in, e-mail-confirmed, not-blocked account with exactly that address.
--   There is no table or API through which anyone can grant themselves admin rights.
-- * Blocked accounts (auth.users.banned_until in the future) can't sign in or refresh a
--   session, and their remaining access tokens can no longer read or write data (RLS).
-- * New registrations are queued in admin_email_queue (one row per account, unique key)
--   and e-mailed to the owner by the admin-mailer Edge Function via Resend.

-- ---- Settings (server only) --------------------------------------------------------------

create table private.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
revoke all on private.app_settings from public, anon, authenticated;

insert into private.app_settings (key, value) values
  ('notify_new_users', '{"enabled": true, "when": "confirmed"}'),  -- when: 'confirmed' | 'created'
  ('mailer_status', '{}')
on conflict (key) do nothing;

create function private.setting(p_key text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select value from private.app_settings where key = p_key;
$$;

create function private.owner_email() returns text
language sql stable security definer set search_path = '' as $$
  select lower(value #>> '{}') from private.app_settings where key = 'owner_email';
$$;

-- ---- Who is the admin --------------------------------------------------------------------

drop function if exists public.admin_overview();
drop function if exists public.admin_list_users(text, int, int);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users u
     where u.id = auth.uid()
       and u.email_confirmed_at is not null
       and (u.banned_until is null or u.banned_until <= now())
       and lower(u.email) = private.owner_email());
$$;

drop table public.app_admins; -- replaced by the owner check above (it was empty)

-- ---- Blocking support for RLS ----------------------------------------------------------------

-- False when the signed-in account has been blocked. Used by the data policies so a
-- blocked person's still-valid access token can't read or change data.
create function public.account_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select u.banned_until is null or u.banned_until <= now() from auth.users u where u.id = auth.uid()), false);
$$;
revoke all on function public.account_active() from public, anon;
grant execute on function public.account_active() to authenticated;

do $$
declare t text;
begin
  foreach t in array array['tasks', 'lists', 'reminders', 'goals'] loop
    execute format('alter policy "own rows: read" on public.%I using ((select auth.uid()) = user_id and (select public.account_active()))', t);
    execute format('alter policy "own rows: add" on public.%I with check ((select auth.uid()) = user_id and (select public.account_active()))', t);
    execute format('alter policy "own rows: change" on public.%I using ((select auth.uid()) = user_id and (select public.account_active())) with check ((select auth.uid()) = user_id and (select public.account_active()))', t);
  end loop;
end $$;
alter policy "own profile: read" on public.profiles using ((select auth.uid()) = id and (select public.account_active()));
alter policy "own profile: update" on public.profiles using ((select auth.uid()) = id and (select public.account_active()))
  with check ((select auth.uid()) = id and (select public.account_active()));

-- ---- Names from sign-up ------------------------------------------------------------------

create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 40))
  on conflict do nothing;
  return new;
end $$;

-- ---- Activity ----------------------------------------------------------------------------
-- One row per person per day on which they opened DailyMate while signed in. Only the
-- date is kept (no times, pages or devices). Used for "active users" numbers.

create table public.user_activity_days (
  user_id uuid not null references auth.users (id) on delete cascade,
  day     date not null,
  primary key (user_id, day)
);
create index user_activity_days_day on public.user_activity_days (day);
alter table public.user_activity_days enable row level security;
revoke all on public.user_activity_days from anon, authenticated;

create table public.user_activity (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  last_active_at timestamptz not null default now()
);
alter table public.user_activity enable row level security;
revoke all on public.user_activity from anon, authenticated;

-- Called by the app when it opens (and at most every 15 minutes after that).
create function public.touch_activity() returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not public.account_active() then return; end if;
  insert into public.user_activity (user_id) values (uid)
  on conflict (user_id) do update set last_active_at = now()
    where public.user_activity.last_active_at < now() - interval '15 minutes';
  insert into public.user_activity_days (user_id, day) values (uid, (now() at time zone 'UTC')::date)
  on conflict do nothing;
end $$;
revoke all on function public.touch_activity() from public, anon;
grant execute on function public.touch_activity() to authenticated;

-- ---- New-registration e-mails --------------------------------------------------------------

create table public.admin_email_queue (
  id              bigint generated always as identity primary key,
  kind            text not null check (kind in ('new_user', 'test')),
  dedupe_key      text not null unique,  -- 'new_user:<user id>' — one e-mail per account, ever
  user_id         uuid references auth.users (id) on delete set null,
  status          text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts        integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until    timestamptz,
  last_error      text,
  provider_id     text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);
create index admin_email_queue_work on public.admin_email_queue (next_attempt_at) where status in ('pending', 'sending');
alter table public.admin_email_queue enable row level security;
revoke all on public.admin_email_queue from anon, authenticated;

-- Queues the e-mail when an account is created or confirmed (see setting notify_new_users).
-- Never blocks a sign-up: any problem is logged instead.
create function private.queue_new_user_email() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s jsonb := coalesce(private.setting('notify_new_users'), '{}');
begin
  if coalesce((s ->> 'enabled')::boolean, false) = false then return new; end if;
  if lower(new.email) = private.owner_email() then return new; end if;
  if (s ->> 'when' = 'created' and tg_op = 'INSERT')
     or (coalesce(s ->> 'when', 'confirmed') = 'confirmed' and new.email_confirmed_at is not null
         and (tg_op = 'INSERT' or old.email_confirmed_at is null)) then
    insert into public.admin_email_queue (kind, dedupe_key, user_id)
    values ('new_user', 'new_user:' || new.id, new.id)
    on conflict (dedupe_key) do nothing;
  end if;
  return new;
exception when others then
  insert into public.integration_events (source, level, message, details)
  values ('admin-mailer', 'error', 'Could not queue a new-user e-mail', jsonb_build_object('error', left(sqlerrm, 200)));
  return new;
end $$;

create trigger on_auth_user_registered after insert or update of email_confirmed_at on auth.users
  for each row execute function private.queue_new_user_email();

-- For the admin-mailer function (service role only).
create function public.admin_mail_claim(p_limit int default 20, p_only_test boolean default false)
returns table (id bigint, kind text, dedupe_key text, attempts int, recipient text,
               user_email text, user_name text, registered_at timestamptz, confirmed_at timestamptz, user_exists boolean)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with c as (
    select q.id from public.admin_email_queue q
     where ((q.status = 'pending' and q.next_attempt_at <= now()) or (q.status = 'sending' and q.locked_until < now()))
       and (not p_only_test or q.kind = 'test')
     order by q.id limit p_limit
     for update skip locked
  )
  update public.admin_email_queue q
     set status = 'sending', attempts = q.attempts + 1, locked_until = now() + interval '2 minutes'
    from c
    join public.admin_email_queue x on x.id = c.id
    left join auth.users u on u.id = x.user_id
    left join public.profiles p on p.id = x.user_id
   where q.id = c.id
  returning q.id, q.kind, q.dedupe_key, q.attempts, private.owner_email(),
            u.email::text, nullif(p.display_name, ''), u.created_at, u.email_confirmed_at, u.id is not null;
end $$;

-- p_outcome: 'sent' | 'retry' (temporary) | 'failed' (permanent) | 'skipped' | 'not_configured'
create function public.admin_mail_report(p_id bigint, p_outcome text, p_error text default null, p_provider_id text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare q public.admin_email_queue;
begin
  select * into q from public.admin_email_queue where id = p_id for update;
  if not found then return; end if;
  update public.admin_email_queue set
    status = case p_outcome
               when 'sent' then 'sent'
               when 'skipped' then 'skipped'
               when 'failed' then 'failed'
               when 'not_configured' then 'pending'
               else case when q.attempts >= 8 then 'failed' else 'pending' end end,
    -- Not configured yet: wait without using up attempts.
    attempts = case when p_outcome = 'not_configured' then greatest(q.attempts - 1, 0) else q.attempts end,
    next_attempt_at = case when p_outcome = 'not_configured' then now() + interval '15 minutes'
                           else now() + make_interval(mins => least(power(2, q.attempts)::int, 240)) end,
    last_error = left(p_error, 500),
    provider_id = coalesce(p_provider_id, q.provider_id),
    sent_at = case when p_outcome = 'sent' then now() else q.sent_at end,
    locked_until = null
  where id = p_id;
end $$;

create function public.admin_mail_set_status(p_status jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into private.app_settings (key, value, updated_at) values ('mailer_status', p_status, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
$$;

-- Queues a test e-mail if p_user is the owner (at most 5 per hour). Returns the new row id, -1 (limit) or -2 (not owner).
create function public.admin_mail_enqueue_test(p_user uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare n int; new_id bigint;
begin
  if not exists (select 1 from auth.users u where u.id = p_user and u.email_confirmed_at is not null
                   and (u.banned_until is null or u.banned_until <= now()) and lower(u.email) = private.owner_email()) then
    return -2;
  end if;
  select count(*) into n from public.admin_email_queue where kind = 'test' and created_at > now() - interval '1 hour';
  if n >= 5 then return -1; end if;
  insert into public.admin_email_queue (kind, dedupe_key, user_id) values ('test', 'test:' || gen_random_uuid(), p_user)
  returning id into new_id;
  insert into public.admin_audit_log (admin_id, action, details) values (p_user, 'send_test_email', '{}');
  return new_id;
end $$;

create function private.admin_mail_has_work() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admin_email_queue
                  where (status = 'pending' and next_attempt_at <= now()) or (status = 'sending' and locked_until < now()));
$$;

-- ---- Admin: dashboard ----------------------------------------------------------------------

create function public.admin_dashboard(p_from date, p_to date, p_tz text default 'America/Toronto')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  tz text := coalesce(nullif(p_tz, ''), 'UTC');
  today date;
  r jsonb;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  perform now() at time zone tz; -- validates the time zone
  today := (now() at time zone tz)::date;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'invalid date range' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'today', today,
    'users', jsonb_build_object(
      'total',       (select count(*) from auth.users),
      'confirmed',   (select count(*) from auth.users where email_confirmed_at is not null),
      'unconfirmed', (select count(*) from auth.users where email_confirmed_at is null),
      'blocked',     (select count(*) from auth.users where banned_until > now()),
      'newToday',    (select count(*) from auth.users where (created_at at time zone tz)::date = today),
      'new7d',       (select count(*) from auth.users where (created_at at time zone tz)::date > today - 7),
      'new30d',      (select count(*) from auth.users where (created_at at time zone tz)::date > today - 30),
      'inRange',     (select count(*) from auth.users where (created_at at time zone tz)::date between p_from and p_to)),
    'active', jsonb_build_object(
      'today', (select count(*) from public.user_activity_days where day = (now() at time zone 'UTC')::date),
      'd7',    (select count(distinct user_id) from public.user_activity_days where day > (now() at time zone 'UTC')::date - 7),
      'd30',   (select count(distinct user_id) from public.user_activity_days where day > (now() at time zone 'UTC')::date - 30),
      'trackedSince', (select min(day) from public.user_activity_days)),
    'series', (select coalesce(jsonb_agg(jsonb_build_object(
                  'day', d::date,
                  'signups', (select count(*) from auth.users u where (u.created_at at time zone tz)::date = d::date),
                  'active',  (select count(*) from public.user_activity_days a where a.day = d::date)) order by d), '[]')
                 from generate_series(p_from, p_to, interval '1 day') d),
    'recent', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]') from (
                 select u.id, u.email, nullif(p.display_name, '') as name, u.created_at, u.email_confirmed_at is not null as confirmed
                   from auth.users u left join public.profiles p on p.id = u.id
                  order by u.created_at desc limit 8) x),
    'usage', jsonb_build_object(
      'tasks',          (select count(*) from public.tasks where deleted_at is null),
      'tasksCreated',   (select count(*) from public.tasks where (created_at at time zone tz)::date between p_from and p_to),
      'tasksCompleted', (select count(*) from public.tasks where deleted_at is null and completed and (completed_at at time zone tz)::date between p_from and p_to),
      'lists',          (select count(*) from public.lists where deleted_at is null),
      'reminders',      (select count(*) from public.reminders where deleted_at is null),
      'repeating',      (select count(*) from public.tasks where deleted_at is null and repeat is not null)
                      + (select count(*) from public.reminders where deleted_at is null and repeat is not null),
      'usersWithTasks',     (select count(distinct user_id) from public.tasks where deleted_at is null),
      'usersWithLists',     (select count(distinct user_id) from public.lists where deleted_at is null),
      'usersWithReminders', (select count(distinct user_id) from public.reminders where deleted_at is null),
      'usersWithPush',      (select count(distinct user_id) from public.push_subscriptions where disabled_at is null),
      'pushDevices',        (select count(*) from public.push_subscriptions where disabled_at is null),
      'notificationsSent',  (select count(*) from public.notification_deliveries where status = 'sent' and (sent_at at time zone tz)::date between p_from and p_to)),
    'health', jsonb_build_object(
      'database', jsonb_build_object('ok', true, 'version', current_setting('server_version'), 'sizeBytes', pg_database_size(current_database())),
      'migrations', (select coalesce(jsonb_agg(jsonb_build_object('version', version, 'name', name) order by version), '[]') from supabase_migrations.schema_migrations),
      'cron', (select coalesce(jsonb_agg(jsonb_build_object(
                 'job', j.jobname, 'schedule', j.schedule, 'active', j.active,
                 'lastRun', (select jsonb_build_object('status', d.status, 'start', d.start_time, 'message', left(d.return_message, 200))
                               from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1),
                 'failures24h', (select count(*) from cron.job_run_details d where d.jobid = j.jobid and d.status <> 'succeeded' and d.start_time > now() - interval '24 hours'))
               order by j.jobname), '[]') from cron.job j),
      'functionCalls24h', (select coalesce(jsonb_object_agg(coalesce(status_code::text, 'error'), n), '{}') from
                            (select status_code, count(*) n from net._http_response where created > now() - interval '24 hours' group by status_code) h),
      'pushConfigured', exists (select 1 from vault.secrets where name = 'push_vapid_public'),
      'errors24h', (select count(*) from public.integration_events where level = 'error' and created_at > now() - interval '24 hours')),
    'email', jsonb_build_object(
      'settings', private.setting('notify_new_users'),
      'mailer', private.setting('mailer_status'),
      'counts', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from public.admin_email_queue group by status) e))
  ) into r;
  return r;
end $$;

-- ---- Admin: users ----------------------------------------------------------------------------

create function public.admin_users(
  p_search text default '', p_status text default 'all', p_from date default null, p_to date default null,
  p_sort text default 'created_desc', p_limit int default 25, p_offset int default 0, p_tz text default 'America/Toronto')
returns table (id uuid, email text, name text, created_at timestamptz, last_sign_in_at timestamptz, last_active_at timestamptz,
               confirmed boolean, blocked boolean, role text, tasks bigint, lists bigint, reminders bigint, push_devices bigint, total bigint)
language plpgsql security definer set search_path = '' as $$
declare q text := lower(btrim(coalesce(p_search, ''))); owner text := private.owner_email(); tz text := coalesce(nullif(p_tz, ''), 'UTC');
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_status not in ('all', 'active', 'unconfirmed', 'blocked') then raise exception 'invalid status' using errcode = '22023'; end if;
  if p_sort not in ('created_desc', 'created_asc', 'email', 'last_active', 'last_sign_in') then raise exception 'invalid sort' using errcode = '22023'; end if;
  return query
  with base as (
    select u.id, u.email::text as email, nullif(p.display_name, '') as name, u.created_at, u.last_sign_in_at, a.last_active_at,
           u.email_confirmed_at is not null as confirmed, coalesce(u.banned_until > now(), false) as blocked,
           case when lower(u.email) = owner then 'owner' else 'user' end as role
      from auth.users u
      left join public.profiles p on p.id = u.id
      left join public.user_activity a on a.user_id = u.id
     where (q = '' or position(q in lower(u.email)) > 0 or position(q in lower(coalesce(p.display_name, ''))) > 0)
       and (p_from is null or (u.created_at at time zone tz)::date >= p_from)
       and (p_to is null or (u.created_at at time zone tz)::date <= p_to)
       and case p_status
             when 'blocked' then coalesce(u.banned_until > now(), false)
             when 'unconfirmed' then u.email_confirmed_at is null
             when 'active' then u.email_confirmed_at is not null and not coalesce(u.banned_until > now(), false)
             else true end
  )
  select b.id, b.email, b.name, b.created_at, b.last_sign_in_at, b.last_active_at, b.confirmed, b.blocked, b.role,
         (select count(*) from public.tasks t where t.user_id = b.id and t.deleted_at is null),
         (select count(*) from public.lists l where l.user_id = b.id and l.deleted_at is null),
         (select count(*) from public.reminders r where r.user_id = b.id and r.deleted_at is null),
         (select count(*) from public.push_subscriptions s where s.user_id = b.id and s.disabled_at is null),
         count(*) over ()
    from base b
   order by
     case when p_sort = 'email' then b.email end asc,
     case when p_sort = 'created_asc' then b.created_at end asc,
     case when p_sort = 'last_active' then b.last_active_at end desc nulls last,
     case when p_sort = 'last_sign_in' then b.last_sign_in_at end desc nulls last,
     b.created_at desc
   limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
end $$;

create function public.admin_user_detail(p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); r jsonb;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select jsonb_build_object(
    'id', u.id, 'email', u.email, 'name', nullif(p.display_name, ''),
    'createdAt', u.created_at, 'confirmedAt', u.email_confirmed_at, 'lastSignInAt', u.last_sign_in_at,
    'lastActiveAt', (select last_active_at from public.user_activity where user_id = u.id),
    'activeDays30', (select count(*) from public.user_activity_days where user_id = u.id and day > current_date - 30),
    'blocked', coalesce(u.banned_until > now(), false),
    'role', case when lower(u.email) = private.owner_email() then 'owner' else 'user' end,
    'provider', coalesce(u.raw_app_meta_data ->> 'provider', 'email'),
    'plan', coalesce((select jsonb_build_object('plan', s.plan, 'status', s.status, 'periodEnd', s.current_period_end)
                        from public.subscriptions s where s.user_id = u.id), '{"plan": "free"}'),
    'counts', jsonb_build_object(
      'tasks',     (select count(*) from public.tasks where user_id = u.id and deleted_at is null),
      'completed', (select count(*) from public.tasks where user_id = u.id and deleted_at is null and completed),
      'lists',     (select count(*) from public.lists where user_id = u.id and deleted_at is null),
      'reminders', (select count(*) from public.reminders where user_id = u.id and deleted_at is null)),
    'devices', (select coalesce(jsonb_agg(jsonb_build_object('label', d.device_label, 'createdAt', d.created_at,
                  'lastSuccessAt', d.last_success_at, 'disabled', d.disabled_reason) order by d.created_at desc), '[]')
                  from public.push_subscriptions d where d.user_id = u.id),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('action', l.action, 'at', l.created_at, 'details', l.details) order by l.id desc), '[]')
                  from public.admin_audit_log l where l.target_user_id = u.id)
  ) into r
  from auth.users u left join public.profiles p on p.id = u.id
  where u.id = p_user;
  if r is null then raise exception 'user not found' using errcode = 'P0002'; end if;
  insert into public.admin_audit_log (admin_id, action, target_user_id) values (me, 'view_user', p_user);
  return r;
end $$;

-- Blocks (or unblocks) an account: no sign-in, sessions ended, no data access, no notifications.
create function public.admin_set_blocked(p_user uuid, p_blocked boolean, p_reason text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); target_email text;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select lower(email) into target_email from auth.users where id = p_user;
  if not found then raise exception 'user not found' using errcode = 'P0002'; end if;
  if p_user = me or target_email = private.owner_email() then raise exception 'the owner account can''t be blocked' using errcode = '22023'; end if;
  if p_blocked and coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required' using errcode = '22023'; end if;
  if p_blocked then
    -- Same representation Supabase Auth uses for a long ban.
    update auth.users set banned_until = now() + interval '100 years' where id = p_user;
    delete from auth.sessions where user_id = p_user; -- also removes their refresh tokens
    update public.push_subscriptions set disabled_at = now(), disabled_reason = 'blocked'
     where user_id = p_user and disabled_at is null;
  else
    update auth.users set banned_until = null where id = p_user;
  end if;
  insert into public.admin_audit_log (admin_id, action, target_user_id, details)
  values (me, case when p_blocked then 'block_user' else 'unblock_user' end, p_user, jsonb_build_object('reason', left(coalesce(p_reason, ''), 300)));
end $$;

-- Deletes an account and everything it owns, as described in the Privacy Policy.
-- The caller must repeat the account's e-mail address. The audit log keeps the user id,
-- the counts and the reason — not the e-mail address or any content.
create function public.admin_delete_user(p_user uuid, p_confirm_email text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); u record; counts jsonb;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select id, lower(email) as email into u from auth.users where id = p_user;
  if not found then raise exception 'user not found' using errcode = 'P0002'; end if;
  if p_user = me or u.email = private.owner_email() then raise exception 'the owner account can''t be deleted here' using errcode = '22023'; end if;
  if lower(btrim(coalesce(p_confirm_email, ''))) <> u.email then raise exception 'the e-mail address doesn''t match' using errcode = '22023'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required' using errcode = '22023'; end if;
  counts := jsonb_build_object(
    'tasks',     (select count(*) from public.tasks where user_id = p_user and deleted_at is null),
    'lists',     (select count(*) from public.lists where user_id = p_user and deleted_at is null),
    'reminders', (select count(*) from public.reminders where user_id = p_user and deleted_at is null));
  delete from auth.users where id = p_user;
  insert into public.admin_audit_log (admin_id, action, target_user_id, details)
  values (me, 'delete_user', p_user, jsonb_build_object('reason', left(p_reason, 300), 'deleted', counts));
  return counts;
end $$;

-- Users for CSV export. With p_mask the e-mail is shortened (j•••@gmail.com) and names left out.
create function public.admin_export_users(p_mask boolean default true)
returns table (email text, name text, created_at timestamptz, confirmed boolean, blocked boolean, last_active_at timestamptz,
               tasks bigint, lists bigint, reminders bigint)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  insert into public.admin_audit_log (admin_id, action, details) values (auth.uid(), 'export_users', jsonb_build_object('masked', p_mask));
  return query
  select case when p_mask then left(u.email, 1) || '•••@' || split_part(u.email, '@', 2) else u.email::text end,
         case when p_mask then null else nullif(p.display_name, '') end,
         u.created_at, u.email_confirmed_at is not null, coalesce(u.banned_until > now(), false), a.last_active_at,
         (select count(*) from public.tasks t where t.user_id = u.id and t.deleted_at is null),
         (select count(*) from public.lists l where l.user_id = u.id and l.deleted_at is null),
         (select count(*) from public.reminders r where r.user_id = u.id and r.deleted_at is null)
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join public.user_activity a on a.user_id = u.id
   order by u.created_at desc;
end $$;

-- ---- Admin: e-mail notifications -----------------------------------------------------------

create function public.admin_email_log(p_limit int default 30)
returns table (id bigint, kind text, status text, attempts int, last_error text, created_at timestamptz, sent_at timestamptz, user_email text)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query select q.id, q.kind, q.status, q.attempts, q.last_error, q.created_at, q.sent_at, u.email::text
                 from public.admin_email_queue q left join auth.users u on u.id = q.user_id
                order by q.id desc limit least(greatest(p_limit, 1), 100);
end $$;

create function public.admin_update_email_settings(p_enabled boolean, p_when text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_when not in ('confirmed', 'created') then raise exception 'invalid option' using errcode = '22023'; end if;
  v := jsonb_build_object('enabled', p_enabled, 'when', p_when);
  update private.app_settings set value = v, updated_at = now() where key = 'notify_new_users';
  insert into public.admin_audit_log (admin_id, action, details) values (auth.uid(), 'email_settings', v);
  return v;
end $$;

-- Puts a failed e-mail back in the queue (same row, so it is still sent at most once).
create function public.admin_retry_email(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  update public.admin_email_queue set status = 'pending', next_attempt_at = now(), attempts = 0, last_error = null
   where id = p_id and status = 'failed';
  insert into public.admin_audit_log (admin_id, action, details) values (auth.uid(), 'retry_email', jsonb_build_object('id', p_id));
end $$;

-- ---- Housekeeping ----------------------------------------------------------------------------

create or replace function private.cleanup_old_records() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.purge_tombstones();
  delete from public.notification_deliveries where created_at < now() - interval '30 days';
  delete from public.push_subscriptions where disabled_at < now() - interval '30 days';
  delete from public.integration_events where created_at < now() - interval '30 days';
  delete from public.admin_email_queue where created_at < now() - interval '180 days' and status in ('sent', 'skipped', 'failed');
  delete from public.user_activity_days where day < current_date - 400;
  delete from cron.job_run_details where end_time < now() - interval '7 days';
end $$;

-- ---- Permissions ---------------------------------------------------------------------------

revoke all on all functions in schema private from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'admin_dashboard(date, date, text)', 'admin_users(text, text, date, date, text, int, int, text)', 'admin_user_detail(uuid)',
    'admin_set_blocked(uuid, boolean, text)', 'admin_delete_user(uuid, text, text)', 'admin_export_users(boolean)',
    'admin_email_log(int)', 'admin_update_email_settings(boolean, text)', 'admin_retry_email(bigint)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array[
    'admin_mail_claim(int, boolean)', 'admin_mail_report(bigint, text, text, text)', 'admin_mail_set_status(jsonb)',
    'admin_mail_enqueue_test(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ---- Schedule: e-mail queue, every minute, only calls the function when there is work ------

select cron.schedule('dailymate-admin-mail', '* * * * *', $job$
  select net.http_post(
    url := 'https://aboenuyweqirlhdzrehd.supabase.co/functions/v1/admin-mailer',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatch-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_dispatch_secret')),
    body := '{"action":"dispatch"}'::jsonb,
    timeout_milliseconds := 25000)
  where private.admin_mail_has_work();
$job$);
