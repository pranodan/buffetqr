# Agent guidance

## Project context

BuffetFlow is an offline-first React 19 application using TanStack Start/Router, plain JavaScript/JSX, Supabase Auth, Supabase Postgres with RLS, and Vercel/Nitro. Read `README.md` for setup and deployment.

## Core architecture

- `src/routes/__root.jsx` defines the document and app providers. There is no `index.html`.
- Routes are file-based under `src/routes/`; protected pages live under `src/routes/_authed/`.
- `src/lib/AuthContext.jsx` resolves the Supabase session and maps the signed-in email to its row in `public.staff`.
- `src/api/supabaseClient.js` is the browser Supabase client. Only the public anon/publishable key may be exposed through `VITE_*`; never add a service-role key to client code or Vercel client environment variables.
- `src/lib/db.js` is the local IndexedDB store. `src/lib/sync.js` handles the offline outbox and shared Supabase data. Preserve offline behavior and make RLS/network errors visible rather than dropping queued work.
- `supabase/migrations/` is the source of truth for database schema and RLS. Any new table or data operation must have appropriate grants and policies.
- `vite.config.js` configures TanStack Start and Nitro's Vercel preset. The deployment target is Vercel, not Base44 or Cloudflare.

## Change practices

- Keep changes focused and follow existing JSX, naming, formatting, and UI patterns.
- Keep authorization enforcement in Supabase RLS; client-side role checks are for user experience, not a security boundary.
- Validate user-provided data before persisting it and surface errors instead of silently treating failures as success.
- Avoid importing the remaining legacy Base44 modules into active routes. If a feature needs one, migrate it to Supabase first.
- Run `npm run lint` and `npm run build` for code changes. Do not edit generated route-tree files by hand.
