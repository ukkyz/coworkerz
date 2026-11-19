# Coworkerz · 3D Executive Suite

You occupy the CEO seat. Give the CTO, CFO and COO a directive, watch them walk between stations, then address a follow-up to one executive or the whole team. The boardroom, labeled *Aether* in the UI, connects a procedural Three.js office to OpenCode-compatible chat completions and a file-backed SQLite record of sessions, insights and enterprise knowledge.

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
4. In OpenCode settings, inspect the gateway, per-role models, temperature and rounds. Provider credentials are optional for local synthesis. **No key does not mean no network:** free model IDs can use a public bearer, and the live client can retry the Zen gateway. Use only synthetic data on a trusted local instance; block provider egress if an offline run is required. The interactive console assumes a trusted CEO; it is not a production identity boundary.

## Customize an executive

In the boardroom header, open **Customize bots**, choose **CTO**, **CFO** or **COO**, then edit **Display name**, **Job**, and **AI skill prompt**. For example, give the CFO the job *Pilot Funding Adviser* and ask it to identify a budget cap before recommending a release gate. **Save** updates that bot's nameplate and labels immediately. **Cancel** discards unsaved edits; **Restore defaults** is a draft change until saved.

The saved guidance applies to that speaker's next model request. Local fallback uses the updated names but is a fixed template, not a model that interprets skill prompts. Model settings, conversation history, memory ownership and enterprise permissions stay with the permanent role, even if two bots share a name.

For an existing SQLite suite, run **`npm run db:migrate`** before starting this release. The migration adds one override table; roles without a row use the built-in profiles. No reseed is necessary.

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
| `npm run test:profiles:ui` | After `npm run build` and `npx playwright install chromium`, runs the keyboard/mobile profile workflow in Chromium, restarts the Next server, and inspects mocked CFO/CTO requests. Creates its own temporary SQLite file; no provider key or running server needed. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use an existing Chromium executable. |
| `npm run typecheck` / `npm run lint` | TypeScript / ESLint against the app |
| `npm run build` then `npm start` | Production build then server; run `db:setup` against the target file first. The root layout uses `next/font/google`, so builds need font access or a populated cache. |

Baseline at `7bb9ac2`: typecheck passed; repo-wide lint reported 12 existing React hook errors in the boardroom, canvas and knowledge views. Recheck on your revision and distinguish new failures; do not disable rules to hide the baseline.

Use [the art budget and capture sheet](docs/art-budgets.md) for visual work and [the model scorecard](docs/turn-evaluation.md) for behavior changes. Neither document claims a production benchmark.
