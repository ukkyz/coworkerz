# Coworkerz · Next.js and bot customization · v1

**Deliverable:** Implement the feature in this checkout. Return Markdown under **Changes**, **Evidence**, and **Remaining risk**. In Evidence, state whether a framework migration was needed and report each check as pass, fail, or not run (with reason).

**Pass when:** The boardroom runs on Next.js App Router. From **Boardroom → Customize bots**, the CEO can independently change the **name**, **job**, and **AI skill prompt** of the CTO, CFO, and COO. Saved edits survive a page reload and server restart, update the visible identity immediately, and guide that bot's next AI turn without changing the other two bots.

### 1. Check the framework before touching it

Read `AGENTS.md`, `package.json`, `next.config.ts`, and `src/app/page.tsx`. This Coworkerz baseline already uses **Next.js 16.4.2** (`next dev`, `next build`, `next start`): confirm it and skip migration. Do not scaffold a second app or upgrade Next just for this task.

Only if Vite actually serves the application in the supplied checkout: port the existing entry, routes, styles and assets into `src/app/layout.tsx` and App Router pages; replace Vite scripts and active router/proxy wiring with Next equivalents. Preserve URLs and API contracts. Replace `import.meta.env` access without making private values `NEXT_PUBLIC_*`. Keep Three.js, DOM and WebGL initialization in mounted client components; keep SQLite and provider calls in server code. Remove obsolete Vite entry/config/dependencies only after the boardroom and routes work in Next.

### 2. Edit profiles, not role IDs

Add a **Customize bots** action beside the existing OpenCode settings in `src/components/ExecutiveBoardroomApp.tsx`. Show a role selector and three labeled plain-text fields: `displayName` (1–80 characters), `job` (title or assignment, 1–120), and `skillPrompt` (multiline guidance on how the bot does its job, 1–2000). Keep `CTO`, `CFO`, `COO` as immutable keys for routing, models, memory, access control and avatar selection. Two bots may have the same display name.

Load the selected bot's saved values. **Save** applies only that bot's edits; **Cancel** discards them; **Restore defaults** changes the draft until saved. Provide keyboard access, Escape/focus return, inline errors and a save-status announcement. The form must work at 375px width without horizontal scrolling. A failed save must retain the draft, not show success.

### 3. Use one effective profile per slot

- Add per-role overrides to `src/db/schema.ts` with a generated, additive Drizzle migration. Resolve missing rows from `EXECUTIVES` in `src/lib/executives.ts`: `name`, `title`, and skill guidance derived from `shortBio`/`specialties`. Existing databases must work after `npm run db:migrate` without deleting data or rerunning the demo seed.
- Add CEO settings handlers: `GET /api/executive-profiles` for the three effective profiles and `PUT /api/executive-profiles/[role]` for one update. Allowlist roles; trim and validate all three fields server-side before writing. Reject invalid input without a partial save. Do not return credentials or change `/api/opencode-config` behavior.
- Load name/job for the boardroom, use them in the selected-bot details and speaker labels, and update the nameplates in `src/components/VirtualOfficeCanvas.tsx` **without remounting the canvas**. Do not rewrite historical message text, session IDs or stored role references.
- In `src/app/api/deliberate/step/route.ts`, resolve the saved profile for the **planned speaker** and pass it to `generateExecutiveDeliberationTurn` in `src/lib/opencode.ts`. Use name/job and the speaker's skill guidance for new live turns. Treat editable text as bounded profile data subordinate to the fixed turn rules; it cannot change the listener, permissions or six-key JSON contract. Use effective names for peer references in local fallback; do not claim deterministic fallback can interpret arbitrary skill instructions. Version the updated turn prompt and note the change.

### 4. Prove the behavior

Use this synthetic CFO edit as an acceptance case:

```json
{"displayName":"Maya Santoso","job":"Pilot Funding Adviser","skillPrompt":"Before recommending spend, identify the budget cap and propose one measurable release gate."}
```

Save, reopen the menu and reload. Verify Maya's label and job, unchanged CTO/COO profiles, and a targeted CFO follow-up still stored as `CFO → CEO`. With a stubbed provider, inspect the outbound messages: the CFO turn contains Maya's job and guidance; a CTO turn does not receive the CFO's skill prompt. Test a blank field, a failed save, Cancel, Restore defaults and migration on a populated disposable SQLite file. Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run build`; report any baseline failures separately. Follow `docs/turn-evaluation.md` for an authorized live check at the configured model and temperature, or mark it **not run**. A stub is not evidence of live model behavior.
