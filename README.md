# Coworkerz · 3D Executive Suite

You occupy the CEO seat. Give the CTO, CFO and COO a directive, watch them walk between stations, then address a follow-up to one executive or the whole team. The boardroom, labeled *Aether* in the UI, connects a procedural Three.js office to OpenCode-compatible chat completions and a PostgreSQL record of sessions, insights and enterprise knowledge.

## Give your next coding agent a task

From the repo root, generate a brief with **one objective and one observable pass condition**:

```sh
node scripts/brief.mjs scene 'Batch the repeated walnut wall slats.' 'At most two slat draw calls in the main color pass; spacing and material match the original in CEO POV and overview.'
```

Paste the output into an agent that has this checkout. No install, database or API key is needed to prepare the brief. Prefer not to run a command? [Copy a task starter](prompts/README.md). [AGENTS.md](AGENTS.md) is the common entry point; the [architecture map](docs/architecture.md) explains which side of the UI/API/renderer boundary owns a change. For a directive to the **in-app executives** rather than to a coding agent, see the [synthetic pilot scenario](docs/turn-evaluation.md).

## Run the application locally

1. Use Node.js 20.9+ (Node 22 recommended), npm and a running PostgreSQL service. Create a **disposable database** and give the development role permission to create tables in its schema. The first boardroom request creates/seeds tables; you do not need a migration command for a fresh DB. `drizzle.config.json` specifies a separate local CLI connection, not the runtime connection.
2. Copy the server environment template without overwriting existing settings: `cp -n .env.example .env`. Set `DATABASE_URL` to that database **before** starting Next.js; `src/db/index.ts` requires it even at import time. The template redirects new memory mirrors away from the tracked samples.
3. Install and start from this directory:

   ```sh
   npm install
   npm run dev
   ```

   Open the URL Next prints (normally `http://localhost:3000`). `GET /api/health` returning `{"ok":true}` checks **database connectivity only**. Open `/` to load the seeded boardroom. There is no lockfile in the initial checkout; use `npm install`, not `npm ci` there.
4. In OpenCode settings, inspect the gateway, per-role models, temperature and rounds. Provider credentials are optional for local synthesis. **No key does not mean no network:** free model IDs can use a public bearer, and the live client can retry the Zen gateway. Use only synthetic data on a trusted local instance; block provider egress if an offline run is required. The interactive console assumes a trusted CEO; it is not a production identity boundary.

| Check | What it exercises |
| --- | --- |
| `node --test scripts/brief.test.mjs` | Prompt assembly only, no app dependencies |
| `npm run typecheck` / `npm run lint` | TypeScript / ESLint against the app |
| `npm run build` then `npm start` | Production build then server; supply `DATABASE_URL`. The root layout uses `next/font/google`, so builds need font access or a populated cache. |

Baseline at `7bb9ac2`: typecheck passed; repo-wide lint reported 12 existing React hook errors in the boardroom, canvas and knowledge views. Recheck on your revision and distinguish new failures; do not disable rules to hide the baseline.

Use [the art budget and capture sheet](docs/art-budgets.md) for visual work and [the model scorecard](docs/turn-evaluation.md) for behavior changes. Neither document claims a production benchmark.
