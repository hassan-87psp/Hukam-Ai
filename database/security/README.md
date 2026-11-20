# Authorization model

The relay uses SQLite (`node:sqlite`), which has no row-level security, so isolation is enforced in code:

* Every user-owned table carries `user_id`. Every relay query that reads or changes such rows includes `user_id = <session user>` (see `apps/relay/src/core.ts`), and lookups by ID return **404** for rows of other users rather than 403, so existence isn't leaked.
* Devices authenticate with their own token (`deviceId.secret`, stored as SHA-256). A device can only report on commands whose `device_id` is its own; it can never read user data, settings or other devices.
* Screenshots are served only through `/api/screenshots/:id` after the same session + `user_id` check; files live outside the public web root.
* Revoked devices keep their row (for history) with `status='revoked'` and are rejected at the WebSocket handshake.

Tests covering this: `apps/relay/test/relay.test.ts` (unauthenticated access, CSRF header, bad device token, revoked token, screenshot without session).

## Moving to Postgres / Supabase later
The schema maps directly. If you move to Supabase, enable RLS on each table with policies of the form:

```sql
alter table commands enable row level security;
create policy "own rows" on commands for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

…and keep device traffic on a server-side component that holds the service key — never in the browser or the controller.
