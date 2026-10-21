-- "User not found" in the admin functions now returns HTTP 404 instead of 500
-- (PostgREST maps SQLSTATE 'PT404' to status 404).
do $$
declare f text; def text;
begin
  foreach f in array array['public.admin_user_detail(uuid)', 'public.admin_set_blocked(uuid, boolean, text)', 'public.admin_delete_user(uuid, text, text)'] loop
    def := pg_get_functiondef(f::regprocedure);
    execute replace(def, 'errcode = ''P0002''', 'errcode = ''PT404''');
  end loop;
end $$;
