# Executive roster: operations and API transition

**Edit a person; replace a role.** In **Customize bots**, **Edit profile** keeps the ID, model, private journal and access unless you explicitly change the settings. **Replace executive** archives that ID and creates a different one in one transaction. **Remove executive** only archives. The CEO can still inspect an archived journal, a transcript, or a historical insight. Reusing even the exact same title does not reactivate the old executive.

## Upgrade without reseeding

Stop old writers. Back up the SQLite database using SQLite's backup API or a checkpointed copy with writers stopped. Point `DATABASE_URL` at that installation and run **`npm run db:migrate`** before serving the new version. Do not run the demo seed to perform an upgrade. To roll back, stop writers and restore the pre-upgrade backup with its matching application version.

`0002_live_executive_roster.sql` creates `executive_roster` and imports the three original identities in creation order. It copies effective names, jobs and skill prompts (including `0001` overrides) and each assigned model from the active config. Their IDs are literally `CTO`, `CFO`, `COO`. Existing message, memory, observation, API-key and item-ACL references therefore keep exactly the same meaning. Migrated entries have the `legacy` access policy. No old messages, grants, or notes are rewritten. `executive_profile_overrides` is historical migration input, **not** an alternative settings store.

## Addressing and CRUD

These are trusted **CEO console** routes, not a public identity provider. Do not expose an unauthenticated console to untrusted clients. An explicit enterprise key or simulated agent cannot administer the roster. Use returned IDs as opaque strings; **never resolve an address by matching a title or display name**.

| Request | Result |
| --- | --- |
| `GET /api/executive-profiles` | `roster`: all identities in creation order. Active iff `retiredAfter === null`. The compatibility `profiles` object maps **active IDs** to the three profile text fields. |
| `POST /api/executive-profiles` | Create from `roleName`, `displayName`, `job`, `skillPrompt`, `model`, `preset`; returns 201 with `executive` and updated roster. New IDs are server-generated `exec-<uuid>`. |
| `PUT /api/executive-profiles/:id` | Save all three profile fields and optionally `model` / `preset`. `roleName` is not editable here. Legacy `PUT .../CFO` still edits only the original CFO. |
| `POST /api/executive-profiles/:id` | Replace an **active** ID, using the same complete request as creation. No personal data, model assignment, ACLs, or keys copied. Failure leaves the old executive active. |
| `DELETE /api/executive-profiles/:id` | Retire that executive; zero active executives is valid. History, model settings and the original journal remain. |
| `GET` / `PUT /api/opencode-config` | `config.models` is keyed by active ID. Send `models: { [id]: modelId }` for changed assignments. Legacy `ctoModel` / `cfoModel` / `cooModel` writes address original IDs only and fail if archived. Shared provider/temperature/round settings remain separate. |
| `POST /api/sessions`, `POST /api/ceo-message` | `targetRole`: `ALL` (default) or an active ID. Legacy short codes on these routes remain case-insensitive. Unknown ID → 404; archived ID or no active recipients → 409. Never redirect a retired address. |
| `GET /api/memory/file?path=executives/:id.md` | CEO journal, including archived owners. No title-derived paths. `/api/v1/agent-memory?executive=:id` requires separate agent-memory permission. |

Example creation body (use an actual model ID available at your gateway):

```json
{"roleName":"Pilot Readiness Lead","displayName":"Ari","job":"Own pilot rehearsals","skillPrompt":"Check the signoff list and name one missing baseline.","model":"opencode/deepseek-v4.1-flash-free","preset":"internal"}
```

There is no fixed seat limit. Active titles are unique after Unicode normalization, trimming and case normalization; display names need not be unique. CTO, CFO, COO, Head of Product, Chief of Staff and General Counsel are suggestions, not an allowlist. Even a title spelled like a special address gets a fresh ID. New/replacement bots **must** select `none`, `internal`, or `confidential` explicitly.

## What happens on the next turn?

- Each step reloads the persisted roster and session. An unanswered direct question goes to its named recipient. Whole-team routing counts distinct matching tokens in the **latest CEO question**, weighting role title, job and skill 3:2:1. Among equal scores (including zero), the least recently heard in this session wins, then creation order. This is deterministic lexical matching, not semantic inference. One executive can brief the CEO without a fabricated peer.
- Shared context includes the CEO directive, recent transcript and shared insights—even ones predating a member's arrival. Only the speaker's skill prompt, model and private recall are used. New members do not get a copy of anyone's personal memory. Join/retirement boundaries use monotonic message IDs so backfill also credits only members present **at the original exchange**.
- Model I/O is outside the database lock. An immediate SQLite transaction rechecks **both** participants, speaker preset and the latest message before committing reply, insight, usage increments, memories and turn count together. On a conflict the pending output is discarded; the client stops its loop. Refresh, retry, or post a new `ceo-message` with a valid ID. With zero bots, settings/history still work but no turn can start.
- A reader can see an item only when its classification is within clearance **and** its ACL contains the ID or `*`. Graph edges also require both visible endpoints. A scoped key further restricts domains/clearance; it cannot widen the preset, write enterprise records or reveal private journals. Retired identities fail authentication. `none` grants no records, including public records. Legacy ACLs/keys retain their prior meaning, not the successor's.
- At most two existing character rigs represent the actual exchange. Address or inspect any active executive from the native selectors even if offscreen. A CEO reply uses one rig; the human is not a bot. Editing/replacing people does not recreate the renderer.

## Verification

`npm test` includes a real populated `0001 → 0002` upgrade, explicit preset and key boundaries, session ties, membership-aware backfill and provider-barrier race tests. `npm run build && npm run test:roster:ui` uses Chromium, two independent Next processes per workflow and a temporary SQLite file. It checks keyboard/focus, 375px layout, direct and whole-team routing, request isolation, archive and restart. Install Chromium with `npx playwright install chromium` or specify `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. All provider traffic in the browser workflows is intercepted **inside the test server**. See the [model evaluation guide](turn-evaluation.md) for separate authorized live checks.

### Evidence from this implementation

- **Migration and ownership:** populated `0001` fixture → `0002` with no reseed. The original CFO retained its customized profile, model, reply, private marker and finance-scoped key. The replacement had a distinct ID, no marker and no access via the old key or item ACL. Separate document, graph-node and edge checks exercised permitted, unlisted and above-clearance items.
- **Runtime:** both Chromium workflows passed after a page reload and a fresh server process. At 375×740 the fourth role was selectable offstage and answered both direct and matching team questions in the open session. The captured transport used `readiness-verified-free` at `0.42`; the peer request did not contain its skill guidance. Races retired the speaker and listener separately; neither produced a reply, insight, memory or use-count increment.
- **Quality gates:** `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:roster:ui`, Drizzle Kit drift and consistency checks passed. Keyboard validation, save focus, Escape and return focus exercised. Scoped axe WCAG A/AA scan of the roster dialog: 17 passing rules, 0 violations, 1 incomplete (`aria-prohibited-attr`). This is not a screen-reader or full WCAG certification.
- **Performance spot check:** one Lighthouse lab navigation to the production preview using headless Chromium/SwiftShader, 375×740, DPR 1, no network/CPU throttling. Performance 68/100, LCP 0.5 s, CLS 0.003, total blocking time 4,420 ms, transfer 404 KiB. High main-thread blocking merits a physical-device trace. This is neither field Web Vitals nor an on-device GPU/overdraw measurement.
- **Not validated here:** a live production provider/model, physical phone frame budgets, field INP, other browser engines, screen-reader output and very large roster load. The trusted local CEO assumption has not changed.
