-- Task 2's initial migration created recipients/message_log/config but did not
-- grant table privileges to service_role. Edge functions authenticate to
-- PostgREST as service_role and need SELECT/INSERT/UPDATE/DELETE to operate
-- on these tables (RLS is not enabled, but Postgres GRANTs are still required).

grant select, insert, update, delete on public.recipients to service_role;
grant select, insert, update, delete on public.message_log to service_role;
grant select, insert, update, delete on public.config to service_role;
