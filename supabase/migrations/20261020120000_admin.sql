-- Administration: who is an admin, what admins did, and how the integrations are doing.
--
-- * Admin rights live in app_admins, which no browser can write to: an admin is
--   added only with SQL by the project owner (see supabase/README.md).
-- * Every admin function checks is_admin() on the server. The admin page in the app
--   is only a view; hiding or showing it is not what protects the data.
-- * Admin views show account facts and counts, never the contents of anyone's
--   tasks, lists or reminders.

create table public.app_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  granted_at timestamptz not null default now(),
  note       text not null default ''
);
alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon, authenticated;

create table public.admin_audit_log (
  id             bigint generated always as identity primary key,
  admin_id       uuid,          -- kept (not a foreign key) so the record survives account deletion
  action         text not null,
  target_user_id uuid,
  details        jsonb not null default '{}',
  created_at     timestamptz not null default now()
);
create index admin_audit_log_created on public.admin_audit_log (created_at desc);
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from anon, authenticated;

-- Operational events from the server functions (errors, dispatcher runs). No personal content.
create table public.integration_events (
  id         bigint generated always as identity primary key,
  source     text not null check (char_length(source) <= 40),
  level      text not null check (level in ('info', 'warning', 'error')),
  message    text not null check (char_length(message) <= 500),
  details    jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index integration_events_created on public.integration_events (created_at desc);
alter table public.integration_events enable row level security;
revoke all on public.integration_events from anon, authenticated;

create function public.log_integration_event(p_source text, p_level text, p_message text, p_details jsonb default '{}')
returns void language sql security definer set search_path = '' as $$
  insert into public.integration_events (source, level, message, details)
  values (left(p_source, 40), p_level, left(p_message, 500), coalesce(p_details, '{}'));
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_admins where user_id = auth.uid());
$$;

create function private.require_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return auth.uid();
end $$;

-- ---- Overview -----------------------------------------------------------------------------

create function public.admin_overview() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  perform private.require_admin();
  select jsonb_build_object(
    'users', jsonb_build_object(
      'total',      (select count(*) from auth.users),
      'confirmed',  (select count(*) from auth.users where email_confirmed_at is not null),
      'new7d',      (select count(*) from auth.users where created_at > now() - interval '7 days'),
      'active7d',   (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days')),
    'plans', (select coalesce(jsonb_object_agg(plan, n), '{}') from
               (select plan, count(*) n from public.subscriptions group by plan) p),
    'push', jsonb_build_object(
      'configured', exists (select 1 from vault.secrets where name = 'push_vapid_public'),
      'activeDevices',   (select count(*) from public.push_subscriptions where disabled_at is null),
      'disabledDevices', (select count(*) from public.push_subscriptions where disabled_at is not null),
      'deliveries24h', (select coalesce(jsonb_object_agg(status, n), '{}') from
                         (select status, count(*) n from public.notification_deliveries
                           where created_at > now() - interval '24 hours' group by status) d),
      'lastSentAt', (select max(sent_at) from public.notification_deliveries)),
    'errors24h', (select count(*) from public.integration_events where level = 'error' and created_at > now() - interval '24 hours'),
    'cron', (select coalesce(jsonb_agg(jsonb_build_object(
                'job', j.jobname, 'schedule', j.schedule, 'active', j.active,
                'lastRun', (select jsonb_build_object('status', d.status, 'start', d.start_time, 'message', left(d.return_message, 200))
                              from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1))), '[]')
               from cron.job j),
    'migrations', (select coalesce(jsonb_agg(jsonb_build_object('version', version, 'name', name) order by version), '[]')
                     from supabase_migrations.schema_migrations),
    'database', jsonb_build_object('sizeBytes', pg_database_size(current_database()), 'version', current_setting('server_version'))
  ) into r;
  return r;
end $$;

-- ---- Users (account facts and counts only) --------------------------------------------------

create function public.admin_list_users(p_search text default '', p_limit int default 50, p_offset int default 0)
returns table (id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz, email_confirmed boolean,
               plan text, plan_status text, tasks bigint, lists bigint, reminders bigint, push_devices bigint, is_admin boolean)
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_admin();
begin
  insert into public.admin_audit_log (admin_id, action, details)
  values (me, 'view_users', jsonb_build_object('search', left(coalesce(p_search, ''), 100), 'offset', p_offset));
  return query
  select u.id, u.email::text, u.created_at, u.last_sign_in_at, u.email_confirmed_at is not null,
         coalesce(s.plan, 'free'), coalesce(s.status, 'active'),
         (select count(*) from public.tasks t where t.user_id = u.id and t.deleted_at is null),
         (select count(*) from public.lists l where l.user_id = u.id and l.deleted_at is null),
         (select count(*) from public.reminders r where r.user_id = u.id and r.deleted_at is null),
         (select count(*) from public.push_subscriptions p where p.user_id = u.id and p.disabled_at is null),
         exists (select 1 from public.app_admins a where a.user_id = u.id)
    from auth.users u
    left join public.subscriptions s on s.user_id = u.id
   where coalesce(p_search, '') = '' or u.email ilike '%' || p_search || '%'
   order by u.created_at desc
   limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end $$;

-- ---- Push deliveries and logs ----------------------------------------------------------------

create function public.admin_recent_deliveries(p_limit int default 50)
returns table (id bigint, user_id uuid, kind text, status text, attempts int, http_status int,
               last_error text, created_at timestamptz, sent_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return query select d.id, d.user_id, d.kind, d.status, d.attempts, d.http_status, d.last_error, d.created_at, d.sent_at
                 from public.notification_deliveries d order by d.id desc limit least(greatest(p_limit, 1), 200);
end $$;

create function public.admin_recent_events(p_limit int default 50)
returns setof public.integration_events
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return query select * from public.integration_events order by id desc limit least(greatest(p_limit, 1), 200);
end $$;

create function public.admin_audit(p_limit int default 50)
returns setof public.admin_audit_log
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return query select * from public.admin_audit_log order by id desc limit least(greatest(p_limit, 1), 200);
end $$;

-- ---- Actions (always audited) --------------------------------------------------------------

-- Turns off push notifications for a user's devices, e.g. after a complaint or abuse.
create function public.admin_disable_push(p_user uuid, p_reason text)
returns integer language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_admin(); n integer;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required' using errcode = '22023'; end if;
  update public.push_subscriptions set disabled_at = now(), disabled_reason = 'admin'
   where user_id = p_user and disabled_at is null;
  get diagnostics n = row_count;
  insert into public.admin_audit_log (admin_id, action, target_user_id, details)
  values (me, 'disable_push', p_user, jsonb_build_object('reason', left(p_reason, 300), 'devices', n));
  return n;
end $$;

-- ---- Housekeeping ------------------------------------------------------------------------

create function private.cleanup_old_records() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.purge_tombstones();
  delete from public.notification_deliveries where created_at < now() - interval '30 days';
  delete from public.push_subscriptions where disabled_at < now() - interval '30 days';
  delete from public.integration_events where created_at < now() - interval '30 days';
  delete from cron.job_run_details where end_time < now() - interval '7 days';
end $$;

-- ---- Permissions ---------------------------------------------------------------------------

revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function public.log_integration_event(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.log_integration_event(text, text, text, jsonb) to service_role;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

do $$
declare f text;
begin
  foreach f in array array['admin_overview()', 'admin_list_users(text, int, int)', 'admin_recent_deliveries(int)',
                           'admin_recent_events(int)', 'admin_audit(int)', 'admin_disable_push(uuid, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
