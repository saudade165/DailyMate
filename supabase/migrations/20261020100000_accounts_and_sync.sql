-- DailyMate accounts and cloud sync.
--
-- Every synced record belongs to exactly one user (user_id) and is only visible to
-- that user (RLS). Records are never hard-deleted by the app: a delete is a
-- "tombstone" (deleted_at set, content wiped) so other devices learn about it.
--
-- Conflicts are resolved per record with "last write wins" on updated_at, which the
-- app sets when the person changes something. The server ignores writes that are
-- older than what it already has, and stamps synced_at so devices can ask
-- "what changed since …".

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---- Profiles ----------------------------------------------------------------------

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 40),
  time_zone    text check (time_zone is null or char_length(time_zone) <= 64),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  synced_at    timestamptz not null default now()
);

-- A profile is created for every new account.
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---- Shared trigger: last write wins + server timestamps ----------------------------

create function private.sync_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- A device with a clock far in the future must not freeze a record for everyone else.
  new.updated_at := least(new.updated_at, now() + interval '5 minutes');
  if tg_op = 'UPDATE' then
    if new.updated_at < old.updated_at then
      return null; -- an older change arrived late: keep what we have
    end if;
    new.created_at := old.created_at;
  end if;
  new.synced_at := clock_timestamp();
  return new;
end $$;

create trigger profiles_sync before insert or update on public.profiles
  for each row execute function private.sync_guard();

-- ---- Tasks ---------------------------------------------------------------------------

create table public.tasks (
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id           text not null check (char_length(id) between 1 and 64),
  title        text not null check (char_length(title) between 1 and 200),
  date         date not null,
  time         text check (time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  priority     text not null default 'none' check (priority in ('none', 'low', 'medium', 'high')),
  notes        text not null default '' check (char_length(notes) <= 1000),
  repeat       text check (repeat in ('daily', 'weekdays', 'weekly', 'monthly', 'yearly')),
  next_id      text check (char_length(next_id) <= 64),
  completed    boolean not null default false,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  synced_at    timestamptz not null default now(),
  primary key (user_id, id)
);
create index tasks_user_synced on public.tasks (user_id, synced_at);

-- ---- Lists (items are kept inside the list, in order) -------------------------------

create table public.lists (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id         text not null check (char_length(id) between 1 and 64),
  name       text not null check (char_length(name) between 1 and 60),
  items      jsonb not null default '[]' check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 500),
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  synced_at  timestamptz not null default now(),
  primary key (user_id, id),
  check (pg_column_size(items) <= 262144)
);
create index lists_user_synced on public.lists (user_id, synced_at);

-- ---- Reminders ----------------------------------------------------------------------

create table public.reminders (
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id            text not null check (char_length(id) between 1 and 64),
  title         text not null check (char_length(title) between 1 and 200),
  date          date not null,
  time          text not null check (time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  tz            text not null check (char_length(tz) between 1 and 64),
  repeat        text check (repeat in ('daily', 'weekdays', 'weekly', 'monthly', 'yearly')),
  task_id       text check (char_length(task_id) <= 64),
  notes         text not null default '' check (char_length(notes) <= 1000),
  done          boolean not null default false,
  done_at       timestamptz,
  snoozed_until timestamptz,
  alerted_for   text check (char_length(alerted_for) <= 32),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  synced_at     timestamptz not null default now(),
  -- Server-computed: the first moment this reminder should alert (null when done or deleted).
  alert_at      timestamptz,
  primary key (user_id, id)
);
create index reminders_user_synced on public.reminders (user_id, synced_at);
create index reminders_alert_at on public.reminders (alert_at) where alert_at is not null;

-- ---- Goals (table ready for the Goals section; the app doesn't use it yet) ----------

create table public.goals (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id          text not null check (char_length(id) between 1 and 64),
  title       text not null check (char_length(title) between 1 and 200),
  notes       text not null default '' check (char_length(notes) <= 1000),
  target_date date,
  done        boolean not null default false,
  done_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  synced_at   timestamptz not null default now(),
  primary key (user_id, id)
);
create index goals_user_synced on public.goals (user_id, synced_at);

-- Deleted records keep only what sync needs: the content is wiped.
create function private.scrub_tombstone() returns trigger
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
      new.title := '-'; new.notes := '';
  end case;
  return new;
end $$;

-- Reminders: validate the time zone and work out when to alert.
create function private.reminder_schedule() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform now() at time zone new.tz; -- raises for an unknown time zone
  if new.deleted_at is not null or new.done then
    new.alert_at := null;
  else
    new.alert_at := greatest(((new.date + new.time::time) at time zone new.tz),
                             coalesce(new.snoozed_until, '-infinity'::timestamptz));
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['tasks', 'lists', 'reminders', 'goals'] loop
    execute format('create trigger %1$s_sync before insert or update on public.%1$I for each row execute function private.sync_guard()', t);
    execute format('create trigger %1$s_scrub before insert or update on public.%1$I for each row execute function private.scrub_tombstone()', t);
  end loop;
end $$;
-- Runs after the "_scrub" trigger (triggers fire in name order).
create trigger reminders_ztimes before insert or update on public.reminders
  for each row execute function private.reminder_schedule();

-- ---- Row Level Security --------------------------------------------------------------

alter table public.profiles  enable row level security;
alter table public.tasks     enable row level security;
alter table public.lists     enable row level security;
alter table public.reminders enable row level security;
alter table public.goals     enable row level security;

create policy "own profile: read"   on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "own profile: update" on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

do $$
declare t text;
begin
  foreach t in array array['tasks', 'lists', 'reminders', 'goals'] loop
    execute format('create policy "own rows: read" on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t);
    execute format('create policy "own rows: add" on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', t);
    execute format('create policy "own rows: change" on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
    -- No delete policy: the app deletes by tombstone; accounts are removed with delete_my_account().
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke delete, truncate, references, trigger on public.%I from authenticated', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end $$;

revoke all on public.profiles from anon;
revoke insert, delete, truncate, references, trigger, update on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, time_zone, updated_at) on public.profiles to authenticated;

-- ---- Account deletion --------------------------------------------------------------
-- Deletes the signed-in user. Everything they own goes with it (on delete cascade):
-- profile, tasks, lists, reminders, goals, push subscriptions, plan and AI usage.

create function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  delete from auth.users where id = uid;
end $$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---- Housekeeping -------------------------------------------------------------------
-- Tombstones are kept 90 days so devices that were offline still learn about deletes.

create function private.purge_tombstones() returns void
language sql security definer set search_path = '' as $$
  delete from public.tasks     where deleted_at < now() - interval '90 days';
  delete from public.lists     where deleted_at < now() - interval '90 days';
  delete from public.reminders where deleted_at < now() - interval '90 days';
  delete from public.goals     where deleted_at < now() - interval '90 days';
$$;
revoke all on all functions in schema private from public, anon, authenticated;
