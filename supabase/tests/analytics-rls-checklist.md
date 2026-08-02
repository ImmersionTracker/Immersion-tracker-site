# Required RLS checks for analytics_events before enabling analytics

Requires `supabase/migrations/0002_analytics_events.sql` deployed. Unlike
`rls-checklist.md`, this table has no per-user rows to isolate - the whole
point is that nobody, including a legitimately signed-in user, can read a
single row back. Use the anon key directly; a second, authenticated session
only matters for check 3.

1. The anon role can insert a row shaped exactly like `lib/analytics-contract.js`'s `toDatabaseRow()` output (`target_language`, `platform`, `content_type`, `active_seconds`, `passive_seconds`, `event_date`, `extension_version`).
2. The anon role cannot select, update, or delete any row, including one it just inserted itself in the same request sequence.
3. An authenticated user (any signed-in account) also cannot select, update, or delete any row - this table grants no read access to anyone through the API, not even the row's own inserter.
4. Inserting a row with an extra, non-allowlisted column (e.g. a `title` or `user_id`) is rejected by Postgres (unknown column), not silently dropped.
5. Inserting a row with an out-of-range value (negative seconds, malformed date, malformed language code, malformed extension version) is rejected by the table's `check` constraints.
6. Database logs and error reporting contain no titles, URLs, or any value that isn't one of the seven allowlisted columns.
