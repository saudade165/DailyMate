-- push_claim can be limited to one user, so a test notification only sends that
-- user's queued messages (and the response can report on them).

drop function public.push_claim(int);

create function public.push_claim(p_limit int default 100, p_user uuid default null)
returns table (delivery_id bigint, kind text, attempts int, endpoint text, p256dh text, auth_secret text,
               title text, body text, reminder_id text, occurrence_key text)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with c as (
    select d.id from public.notification_deliveries d
     where ((d.status in ('pending', 'retry') and d.next_attempt_at <= now())
        or (d.status = 'sending' and d.locked_until < now()))
       and (p_user is null or d.user_id = p_user)
     order by d.id limit p_limit
     for update skip locked
  )
  update public.notification_deliveries d
     set status = 'sending', attempts = d.attempts + 1, locked_until = now() + interval '2 minutes'
    from c
    join public.notification_deliveries x on x.id = c.id
    join public.push_subscriptions s on s.id = x.subscription_id
    left join public.reminders r on r.user_id = x.user_id and r.id = x.reminder_id and x.kind = 'reminder'
   where d.id = c.id
  returning d.id, d.kind, d.attempts, s.endpoint, s.p256dh, s.auth_secret,
            case when d.kind = 'test' then 'DailyMate test notification' else coalesce(r.title, 'Reminder') end,
            case when d.kind = 'test' then 'Notifications are working on this device.'
                 else coalesce(nullif(r.notes, ''), 'DailyMate reminder') end,
            d.reminder_id, d.occurrence_key;
end $$;

revoke all on function public.push_claim(int, uuid) from public, anon, authenticated;
grant execute on function public.push_claim(int, uuid) to service_role;
