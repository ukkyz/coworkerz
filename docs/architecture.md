# One CEO directive, end to end

**Boundary:** `src/app/page.tsx` renders the client `ExecutiveBoardroomApp`. The app uses Next.js route handlers in the same service, Drizzle over file-backed SQLite (`better-sqlite3`) on the server, and imperative Three.js in a client effect. There is no separate game server or autonomous background agent scheduler. Versions and commands live in `package.json`; `@/` resolves to `src/`.

## Trace a turn

1. **Hydrate.** `GET /api/boardroom[?sessionId=…]` reads the initialized SQLite file for sessions, transcript, notes, masked config and a preview of the next plan. The initial completed session is seeded demo data, not evidence of a live model run.
2. **Direct.** `POST /api/sessions` with `{ceoQuestion, autoWalkAndTalk}` persists the session and the human directive (optionally addressed via `targetRole`) and returns `firstStepPlan`. For an existing session, `POST /api/ceo-message` with `{sessionId, content, targetRole}` records a follow-up and returns `nextPlan`. The target is `ALL` or an active executive ID.
3. **Plan.** The client previews movement, then posts **only** `{sessionId}` to `/api/deliberate/step`. The handler reconstructs ordered history and calls `planDeliberationStep` in `src/lib/turn-planner.ts` with the persisted roster. Turns are counted **since the last CEO message** for planning, not from the session's cumulative `turnCount`. A targeted follow-up gets a direct `ceo_response`; for `ALL`, title/job/skill relevance chooses the responder; ties go to least recently heard, then creation order. Normal peer turns are `walk_and_talk`; a cycle ends with `executive_consensus` at `ceo-briefing`.
4. **Ground and speak.** The handler retrieves up to four ranked conversation notes, a persona brief, speaker recall, and a separate role-scoped enterprise brief (up to three document passages, pending review excluded, plus ACL-filtered graph triples). `generateExecutiveDeliberationTurn` builds the messages and selects the speaker's model. **The model writes dialogue and an insight; it does not choose who moves or speaks.** See [provider behavior and evaluation](turn-evaluation.md).
5. **Persist and display.** After generation the step revalidates participants and the transcript. One transaction writes the message, `knowledge_entries` note and per-executive memories, updates the session, and returns `message`, `knowledgeEntry`, `session`, `currentPlan`, `nextPlan`, `cycleCompleted` and recall counts. `after()` schedules `runMemorySync`; disk mirrors are not a synchronous acknowledgement. The client drives `ActiveChoreography` from `currentPlan` and the saved text, optionally speaks it via browser speech synthesis, then schedules another HTTP step only if auto mode continues. Even manual mode runs the first turn after a new directive.

`src/lib/executives.ts` defines the cast and spatial vocabulary. These are **initial defaults**, not model availability or the active DB configuration:

| Executive | Lens / visual cue | Default model display ID |
| --- | --- | --- |
| Dr. Elena Vance · CTO | Architecture, latency and technical debt / blue | `opencode/deepseek-v4.1-flash-free` |
| Marcus Sterling · CFO | Capital allocation, margins and payback / teal | `opencode/mimo-v2.6-flash-free` |
| Sophia Alverez · COO | Execution, owners and SLAs / amber | `opencode/nemotron-3.5-lightning-free` |

**Identity is not an avatar or title.** `src/app/page.tsx` and `GET /api/boardroom` load `getRoster()` from SQLite. UI selectors use stable IDs. The canvas reuses a speaker rig and a listener rig; it never builds one mesh per member. `generateExecutiveDeliberationTurn` receives only the selected speaker's settings and listener label. See [the roster contract](executive-roster.md) for creation, archival, permissions and migration.

The five station IDs are `ceo-briefing`, `strategy-table`, `tech-wall`, `finance-desk`, `window-lounge`. Change `ROOM_ZONES` slots in `executives.ts`, not in a prompt. Check `TABLE_OBSTACLE` in `VirtualOfficeCanvas.tsx` when changing the table footprint. Rounds are a provider-config setting (four initially; the config route clamps updates to 2–6), not a count of stations.

## Two knowledge planes, not two interchangeable sources

| | Authoritative state and interface | Rule for changes |
| --- | --- | --- |
| **A · Governed enterprise knowledge** | `ek_*` tables; `/api/v1/enterprise/` documents, taxonomy, classify, retrieve, graph, mindmap, api-keys and openapi handlers | `resolvePrincipal` / `canPrincipalRead` in `src/lib/enterprise-knowledge.ts` govern scope, clearance and role. Filter before ranking/answer synthesis. Passage review status and graph ACLs are distinct checks. `src/lib/enterprise-taxonomy.ts` owns the default SKOS scheme, chunking, lexical scoring and local hashed embeddings; no external vector store is required. |
| **B · Conversation and agent memory** | `conversation_messages`, `knowledge_entries`, `executive_memories`, `ceo_persona`, `persona_revisions`; `/api/knowledge`, `/api/memory`, `/api/memory/file`, `/api/v1/agent-memory` | Notes are not approved policies. The CEO can explicitly promote a note into a new document for review (`handlePromoteInsightToEnterpriseKb`). The versioned memory API checks `canReadAgentMemory`. Enterprise retrieval's optional `isolatedAgentMemory` envelope is separately permissioned, not input to its enterprise answer. |

- **UI split:** `EnterpriseKnowledgeModal` opens the document/review and retrieval tools. `KnowledgeGraphView` draws an SVG graph; `MermaidMindmapView` renders Mermaid. Neither is part of the Three.js render loop. `MemoryPanel` is the persona/journal view.
- **Schema and data jobs:** `src/db/schema.ts` defines SQLite tables. Drizzle Kit applies versioned SQL in `drizzle/`; `scripts/seed.ts` inserts the two demo datasets in one transaction with a seed receipt. Neither job runs in a request. Foreign keys are enabled on every app connection. JSON is stored as text, booleans as integers and dates as epoch milliseconds; the Drizzle result types and API JSON shapes are unchanged.
- **Disk split:** `src/lib/memory.ts` regenerates transcripts, journals and the persona under `MEMORY_DIR` (default `memory/`). The enterprise service mirrors taxonomy YAML and Turtle under `KNOWLEDGE_DIR` (default `knowledge/`) on seed or taxonomy update. Do not use either directory as persistent instructions to a coding agent. Inspect `git status` for mirror churn after a smoke test.

## CEO discussion baseline

The [radar panel](../src/components/CeoBaselinePanel.tsx) fetches `GET /api/ceo-baseline` only when opened or refreshed. This trusted-CEO endpoint returns the single saved snapshot, or a read-only preview. The [store](../src/lib/ceo-baseline-store.ts) projects the saved persona's eight topic scores/counts without exposing quotes. On a new installation without a persona, it applies the [same local topic rules](../src/lib/persona-topic-signals.ts) to CEO messages only. It never rebuilds memory, generates a turn, or calls a model. A saved persona can lag an in-flight analysis; the chart identifies the source version and number of CEO messages analyzed.

`POST /api/ceo-baseline` accepts only `{expectedRevision: number}`: `0` for first capture, the displayed revision for explicit replacement. An immediate transaction reads the source and saves the snapshot; a stale revision returns 409 and an empty source returns 422 without touching the baseline. Migration `0003` creates the empty singleton table without copying transcripts or seeding scores. Exported memories, enterprise retrieval and model prompts do not consume the snapshot.

**Proposed, not implemented:** [ADR-001 · Measure a practiced behavior, not conversation activity](decisions/0001-personal-excellence.md) describes how the human CEO could track personal progress without turning persona scores or knowledge retrieval into performance grades.

## Model gateway boundary

The boardroom owns a conversation ID; the transport maps it to an opaque OpenCode session. Turns, service completions and the diagnostic all use one Chat Completions sender. Provider-specific extra headers are server deployment policy keyed by exact base, not role/profile fields. SQLite already provides the durability and atomic allocation needed for optional request numbering. The trade-offs are one local write per numbered attempt and no transparent cross-provider failover: credentials, transcripts and billing stay at the chosen destination. See [gateway setup](model-gateways.md).
