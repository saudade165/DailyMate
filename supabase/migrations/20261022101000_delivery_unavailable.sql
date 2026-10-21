-- 'unavailable' (the Resend key may only send, not read status) is a final delivery state.
create or replace function public.admin_mail_delivery_pending(p_limit int default 20)
returns table (id bigint, provider_id text)
language sql security definer set search_path = '' as $$
  select q.id, q.provider_id from public.admin_email_queue q
   where q.status = 'sent' and q.provider_id is not null and q.sent_at > now() - interval '3 days'
     and coalesce(q.delivery_status, '') not in ('delivered', 'bounced', 'complained', 'opened', 'clicked', 'failed', 'canceled', 'unavailable')
     and (q.delivery_checked_at is null or q.delivery_checked_at < now() - interval '5 minutes')
   order by q.id limit p_limit;
$$;
