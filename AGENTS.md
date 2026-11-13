# KJ Trail implementation rules

Build a real local full-stack MVP. Public launch is a separate gate: verified course content, translations, moderation staffing, hosting and recovery evidence are required. Never portray synthetic fixtures as real route guidance. Do not invent trail facts.

Architecture: React + TypeScript + Vite client, Node 24+ native HTTP server. DATABASE_URL selects PostgreSQL (Supabase private kj_trail schema); without it, SQLite remains available for local use. Never silently fall back after a PostgreSQL connection error. API uses same-origin /api with existing custom sessions and server authorization, not direct browser DB access. Poll chat authorized on every fetch; do not claim WebSocket delivery. Keep migration and service boundaries for later hosted deployment. No ChatGPT identity requirement for visitors.

Security: server-side session and permission checks; member/content/moderator/admin capabilities; no client-controlled role. All mutations enforce same-origin and JSON. Parameterized SQL, bounded inputs, cookie sessions, scrypt passwords, no credentials in source. No default admin credentials. Local CLI may grant a registered user admin rights. Admin actions require a reason, optimistic version check, durable audit in same transaction. Fixture DB stays separate from real data.

Quality: npm run verify must typecheck, test real API/auth/chat/content failure cases and build. Record executed results truthfully. Follow /docs/turnkey protocol. Never execute fictional feedback or MVP2 evidence. Commit only source and lockfiles, no node_modules, runtime SQLite, logs or secrets.

UI: Korean default with English/Traditional Chinese selectable. Forest green #244F40, gold #C9953C, sand #F1EBDD, ink #1A2420. Responsive, accessible native controls, clear empty/failure states and demo labels.
