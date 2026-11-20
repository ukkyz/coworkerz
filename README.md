# Coworkerz · 3D Executive Suite

You occupy the CEO seat. Start with a CTO, CFO and COO, or assemble your own executive team. Address one person or ask the whole team; the room stages the current exchange. The boardroom, labeled *Aether* in the UI, connects a procedural Three.js office to OpenCode-compatible chat completions and a file-backed SQLite record of sessions, insights and enterprise knowledge.

## Give your next coding agent a task

From the repo root, generate a brief with **one objective and one observable pass condition**:

```sh
node scripts/brief.mjs scene 'Batch the repeated walnut wall slats.' 'At most two slat draw calls in the main color pass; spacing and material match the original in CEO POV and overview.'
```

Paste the output into an agent that has this checkout. No install, database or API key is needed to prepare the brief. Prefer not to run a command? [Copy a task starter](prompts/README.md). [AGENTS.md](AGENTS.md) is the common entry point; the [architecture map](docs/architecture.md) explains which side of the UI/API/renderer boundary owns a change. For a directive to the **in-app executives** rather than to a coding agent, see the [synthetic pilot scenario](docs/turn-evaluation.md).

## Run the application locally

1. Use **Node.js 22+** and npm. No database server, Docker container or API key is required for setup. The server uses Drizzle ORM with the native `better-sqlite3` driver. If npm invokes `node-gyp` on a network-restricted host, use matching local Node headers instead of downloading them: in this Arena environment, run `npm_config_nodedir=/usr/local npm ci` in place of `npm ci` below.
2. From the repository root, copy the template without overwriting existing settings and initialize the local file:

   ```sh
   cp -n .env.example .env
   npm ci
   npm run db:setup
   npm run dev
   ```

   `DATABASE_URL` defaults to `.local/coworkerz.sqlite`. If your `.env` still has a PostgreSQL URL, replace it **before setup**. Use a local path, absolute or relative to the project root (`file:./data/suite.sqlite` also works). The CLI and Next use the same env-file precedence and create missing parent directories. Set `NODE_ENV=production` for jobs that should load `.env.production`. Point `MEMORY_DIR` and `KNOWLEDGE_DIR` at throwaway directories for testing.
3. Open the URL Next prints (normally `http://localhost:3000`). `/api/health` checks connection access only; `/api/boardroom` exercises the migrated schema and seed. Requests no longer create tables or repopulate the demo.
4. In OpenCode settings, inspect the gateway, per-role models, temperature and rounds. Provider credentials are optional for local synthesis. **No key does not mean no network:** free model IDs can use a public bearer, and the live client can retry the Zen gateway. Use only synthetic data on a trusted local instance; set `OPENCODE_OFFLINE=1` to disable provider requests (including gateway diagnostics) for an offline run. The interactive console assumes a trusted CEO; it is not a production identity boundary.

## Manage the executive roster

Open **Customize bots** to add an executive with a suggested or custom role, job, skill prompt, model and explicit access preset. **Edit profile** preserves identity. **Replace executive** and **Remove executive** archive the old identity; its journal and transcript stay available to the CEO. All active executives remain selectable in an open session, even when offscreen. With no active executives, deliberations pause.

**Existing database?** Back it up, stop old writers and run **`npm run db:migrate`**. No reseed. See the [migration, API transition and permissions guide](docs/executive-roster.md). In particular, `CFO` never becomes an alias for a successor.

## Capture the CEO’s knowledge radar

Choose **CEO radar** in the dashboard header, or **Radar** in the intelligence panel. The eight axes are the existing CEO persona topics. Each dot is a discussion signal on a 0–100 scale, **not a knowledge test**. A missing dot means *unobserved*, not zero. The table below the chart gives the exact scores and keyword counts. Seeded CEO messages count if you keep the demo conversation.

The first view is an unsaved preview. Select **Capture baseline** to freeze the signals and date in SQLite. New messages, persona rebuilds, and app restarts do not change it. **Replace baseline…** requires confirmation and discards the previous snapshot. Viewing or capturing the chart makes no model calls. Existing installations need `npm run db:migrate` (migration `0003`); do not reseed.

## Database lifecycle

| Command | When to run it |
| --- | --- |
| `npm run db:generate -- --name describe_change` | After editing `src/db/schema.ts`. Review and commit the generated SQL **and** `drizzle/meta/`; keep applied migrations immutable. |
| `npm run db:migrate` | Before serving each release. Applies pending migrations to the configured file; does not insert demo data. |
| `npm run db:seed` | After migrating a new suite. Adds OpenCode settings, a completed session, messages, notes, domains, taxonomy, documents/chunks and graph. No model calls. A transaction records the seed once; reruns preserve edits and deletions. |
| `npm run db:setup` | Runs migrate then seed. Safe to repeat; regenerates taxonomy mirrors from the saved scheme. |

**Deployment:** use a Node server with a writable, persistent **local** volume for the SQLite file and its WAL/SHM sidecars. Do not put it in `public/`, commit it, or rely on ephemeral/serverless instance storage. Run the setup job with development tooling installed. Restrict filesystem access: the DB can contain transcripts and credentials saved via the UI. Use SQLite's online backup facility (or stop writers and checkpoint before copying); copying only a live `.sqlite` file can omit recent writes.

**Existing PostgreSQL installations:** these are SQLite *schema* migrations, not a live data converter. Nothing reads, modifies or imports the old DB. Keep its backup; if history is required, migrate an empty SQLite file, import in foreign-key order preserving IDs (JSON as JSON text, booleans as 0/1 and dates as epoch milliseconds), validate row counts and `PRAGMA foreign_key_check` on a copy before cutover. Do not overlay the demo seed on an imported dataset with its own configuration and taxonomy.

| Check | What it exercises |
| --- | --- |
| `node --test scripts/brief.test.mjs` | Prompt assembly only, no app dependencies |
| `npm run test:db` | Exercises fresh and populated temporary SQLite files: migrations, isolated profile writes/validation, fallback names, memory and enterprise retrieval |
| `npm run test:roster:ui` | After `npm run build` and `npx playwright install chromium`, runs the keyboard/mobile profile and live-roster workflows in Chromium, restarts Next, and inspects mocked identity-scoped requests. `test:profiles:ui` runs just the original edit regression. Creates its own temporary SQLite file; no provider key or running server needed. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use an existing Chromium executable. |
| `npm run test:baseline:ui` | After the same production build/Chromium setup, exercises the CEO radar on mobile and desktop, capture, keyboard access, accessibility scan and persistence across a server restart. |
| `npm run typecheck` / `npm run lint` | TypeScript / ESLint against the app |
| `npm run build` then `npm start` | Production build then server; run `db:setup` against the target file first. The original Inter and Plus Jakarta Sans faces are bundled from pinned Fontsource packages via `next/font/local`; no Google Fonts connection is needed at build time. |

Baseline at `7bb9ac2`: typecheck passed; repo-wide lint reported 12 existing React hook errors in the boardroom, canvas and knowledge views. Recheck on your revision and distinguish new failures; do not disable rules to hide the baseline.

Use [the art budget and capture sheet](docs/art-budgets.md) for visual work and [the model scorecard](docs/turn-evaluation.md) for behavior changes. Neither document claims a production benchmark.
