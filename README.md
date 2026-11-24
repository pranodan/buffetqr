# BuffetFlow

BuffetFlow is an offline-first conference registration and buffet-redemption app built with React 19 and TanStack Start. Supabase provides authentication and the shared database; Vercel hosts the app.

## Requirements

- Node.js `>=22.22.0`
- A Supabase project

## Local setup

```powershell
npm ci
Copy-Item .env.example .env.local
```

Set these public Supabase project values in `.env.local`:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-or-publishable-key
```

Only the public anon/publishable key belongs in the browser app. Never use a Supabase `service_role` key in a `VITE_*` variable.

Apply [`supabase/migrations/20261124000000_initial_schema.sql`](./supabase/migrations/20261124000000_initial_schema.sql) to a **new, empty Supabase database** using the Supabase SQL Editor. The migration creates the schema, indexes, helper functions, and row-level security policies.

Create the first admin:

1. Register the admin's email through the app and complete email confirmation, or create the user in Supabase Authentication.
2. In the Supabase SQL Editor, assign that email the admin role:

   ```sql
   insert into public.staff (email, display_name, role)
   values ('admin@example.com', 'Conference Admin', 'admin')
   on conflict (email) do update
     set display_name = excluded.display_name, role = excluded.role;
   ```

3. Sign in with that account. The admin can assign additional staff emails and roles from Settings. Staff must register with the assigned email before they can access conference data.

The database is fresh; Base44 cloud records are not migrated. The app uses a new IndexedDB name for Supabase, so any previous browser-local database is left untouched and is not automatically uploaded.

Run the app and checks:

```powershell
npm run dev
npm run lint
npm run build
```

## Supabase Auth configuration

In Supabase Authentication → URL Configuration, set the deployed app as the Site URL and add local and deployed app URLs to Redirect URLs. Include the Vite development URL shown by `npm run dev` (commonly `http://localhost:3000/**`) and your Vercel/custom-domain URL (for example `https://your-app.vercel.app/**`).

Email confirmation and password-reset links use Supabase Auth. If Google sign-in is enabled, configure its OAuth provider in Supabase and allow the same callback/redirect URLs there.

## Deploy to Vercel

1. Push this repository to `https://github.com/pranodan/buffetqr`.
2. In Vercel, import the `pranodan/buffetqr` repository. Use the repository root as the project root, `npm ci` for install, and `npm run build` for build. The Vercel Nitro preset is configured in `vite.config.js`.
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the Vercel project's Production, Preview, and Development environments as needed.
4. Deploy, then add the resulting Vercel URL to Supabase Auth's Redirect URLs and set it as the Site URL.

The app's data operations are made from the browser using the public Supabase key. Row-level security is enabled for every application table; do not disable those policies to work around an authorization error.

## Architecture notes

- Routes live in `src/routes/`; authenticated pages are grouped under `src/routes/_authed/`.
- Supabase Auth and staff-role lookup are handled by `src/lib/AuthContext.jsx`.
- `src/lib/db.js` stores operational data in IndexedDB for offline use. `src/lib/sync.js` pushes queued changes and pulls shared Supabase records when online.
- The database schema and policies are maintained in `supabase/migrations/`.
- TanStack Start/Router are used for routing and SSR and are retained.
- A few unreferenced Base44 compatibility files remain from the source project; they are not part of the Supabase/Vercel runtime. Do not wire them into active routes without replacing their Base44 calls.
