# Supabase preparation

Nothing in this directory is connected to the extension yet. The SQL migration is designed for a future Supabase project and must be reviewed in a disposable project before production use.

## Safe activation order

1. Create separate development and production Supabase projects.
2. Run `migrations/0001_cloud_foundation.sql` in development only.
3. Run the row-level-security checks in `tests/rls-checklist.md` with two unrelated test users.
4. Configure an approved sign-in method and its Chrome-extension redirect URLs.
5. Copy `config/cloud-config.example.json` to an untracked build-time configuration file and fill in the development project URL and anon key. Never package the service-role key.
6. Implement a thin Supabase adapter behind `lib/cloud-contract.js`; do not change analytics or tracking code.
7. Keep uploads disabled until offline, reset, account deletion, and two-device tests pass.
8. Only then update the privacy policy and Chrome Web Store disclosures before enabling cloud sync for users.

## Important boundaries

- The database receives daily totals only: date, language, source, active time, passive time, and session count.
- Titles, URLs, remembered content decisions, and manual action labels remain local.
- The extension may use only the Supabase anon key. Entitlement changes require a trusted server or webhook using server-side credentials.
- Retried uploads replace one device snapshot; they never add time to an existing row.
- A reset increments the user's data generation so an offline device cannot silently restore pre-reset rows.
