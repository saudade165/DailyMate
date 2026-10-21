-- Scheduled jobs (pg_cron) and outgoing HTTP (pg_net).
--
-- dailymate-push-dispatch, every minute:
--   queues due reminders (idempotent) and, only when there is something to send or the
--   VAPID keys still have to be created, calls the push-dispatch Edge Function with a
--   secret from Vault. Quiet minutes cost no function invocation.
-- dailymate-cleanup, daily: removes old tombstones, delivery records and logs.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create function private.push_has_work() returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform private.push_enqueue_due(now());
  return not exists (select 1 from vault.secrets where name = 'push_vapid_public')
      or exists (select 1 from public.notification_deliveries
                  where (status in ('pending', 'retry') and next_attempt_at <= now())
                     or (status = 'sending' and locked_until < now()));
end $$;
revoke all on function private.push_has_work() from public, anon, authenticated;

select cron.schedule('dailymate-push-dispatch', '* * * * *', $job$
  select net.http_post(
    url := 'https://aboenuyweqirlhdzrehd.supabase.co/functions/v1/push-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatch-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_dispatch_secret')),
    body := '{"action":"dispatch"}'::jsonb,
    timeout_milliseconds := 25000)
  where private.push_has_work();
$job$);

select cron.schedule('dailymate-cleanup', '17 3 * * *', $job$ select private.cleanup_old_records(); $job$);
