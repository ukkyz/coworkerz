# Brief a Coworkerz agent

**Pick the recipient first.** A *coding agent* needs a change to make, a read set and an observable pass condition. A *boardroom executive* needs a CEO decision, facts, unknowns and a time horizon. Do not put development instructions into the CEO persona, journals or enterprise KB.

**Ready-to-paste feature prompts:** Give the relevant file to a coding agent with the checkout.

- [Custom executive roles and a live roster · v1](features/dynamic-executive-roster.v1.md) — add or replace independently addressable executives, with suggested or custom role names, separate histories, and CEO-selected permission presets.
- [Next.js and bot customization · v1](features/nextjs-bot-customization.v1.md) — the earlier brief for editing a bot's personal display name, job and skill prompt in the original three slots. Use the roster brief above to change the role itself.

## Coding agent · v1 contract, versioned task cards

If you have 30 seconds, paste this completed brief into an agent with the checkout:

```text
Coworkerz / scene / v1. Deliverable: implement the edit and return Changes, Evidence and Remaining risk.
Pass if the walnut slats use at most two main-color-pass draw calls (one batch per wall), with unchanged count, placement and material in CEO POV and overview.
Read AGENTS.md and docs/art-budgets.md. Batch only the repeated walnut slats in src/components/VirtualOfficeCanvas.tsx. Do not change the light rig, camera paths, executive meshes or API. Compare before/after on the same device, render size and camera. Give peak calls and p95 frame time; mark any measurement you cannot take as unmeasured.
```

For another task, run `node scripts/brief.mjs AREA 'objective' 'observable pass condition'` from the repo root and paste stdout. The tool combines [the output contract](v1/brief.md) with **one** card. It needs only Node and reads no source, environment or runtime data. Without a shell, fill `{{objective}}` and `{{acceptance}}` in the contract and paste the selected card in place of `{{card}}`.

| Area / card | Example objective | Example pass condition |
| --- | --- | --- |
| [scene](v1/cards/scene.md) | Batch the walnut slats | ≤2 slat calls in the color pass; unchanged silhouette in CEO POV and overview |
| [boardroom](v2/cards/boardroom.md) | Show which executive is preparing a direct reply | After a CFO follow-up with auto off, one pending CFO label becomes one saved CFO reply; no duplicate after reload |
| [storage](v2/cards/storage.md) | Migrate a session field without losing history | Existing session reloads with the intended value; a second migrate/seed run changes no rows |
| [turn](v1/cards/turn.md) | Make CFO direct answers distinguish a proposed gate from measured savings | In all three CFO follow-up trials of `pilot-v1`, raw finance JSON gives one gate, acknowledges missing baseline and claims no measured ROI |
| [knowledge](v1/cards/knowledge.md) | Surface the review state after promoting a session note | A promoted synthetic note shows as pending; it is absent from executive retrieval passages until approved and only visible within scope |

Add device/viewport or actual model/temperature when known, plus any forbidden paths or dependencies. For a bug include the **shortest synthetic reproduction**, expected vs. observed result and one control that must still work. For review-only work replace the deliverable with “no edits; return a table of finding, `path:symbol`, impact, and verification step”. If the agent cannot access the repo, attach only the referenced code slice and relevant guide after redaction, not the entire checkout.

## In-app executives · `pilot-v1`

Use `session.ceoQuestion` from [the fixture](v1/turn-fixture.json) as a new CEO directive. For the scored case, select CFO and send `followUp.content`. `exampleRawFollowUp` illustrates the desired model JSON, **not** the text to paste as CEO. [The evaluation guide](../docs/turn-evaluation.md) explains why a convincing speech bubble alone cannot establish a live-prompt pass.

To explore the same pilot outside the scored run, choose a target in the composer. Expect a spoken answer plus a session insight; ask for one decision you can check:

| Address | Copyable follow-up |
| --- | --- |
| CTO | Name one instrumentation change and one latency metric for this pilot. Distinguish the target from an observed result. |
| CFO | Give one funding gate that stays within the $120,000 cap. Identify which input is missing to calculate payback. |
| COO | Name the accountable role and one week-six checkpoint. Define what that owner measures before recommending rollout. |

## Compare and version

- For a **coding brief**, compare the same task, starting revision, tool permissions and target agent/model settings in fresh contexts. Record model + temperature (or **not exposed**), first-pass acceptance, extra clarification turns and out-of-scope edits. Pass only if the requested output and all acceptance checks are satisfied; record unverified gates rather than counting them. Do not call runs with different settings a controlled A/B.
- For a **runtime prompt**, score the actual production-equivalent model and temperature per role, not the coding agent. Record the revision, hypothesis, fixture, results and known failures; never store tokens or private completions here.
- For a changed output contract, instruction or fixture, copy the affected pack into a new version directory, update the CLI default and links/tests, and record what changed here. Keep earlier versions for replay. Inline runtime prompts remain owned by their functions in `src/lib/`; version their changes separately rather than maintaining a second active system prompt here.

### Changelog

| Version | Change | Validation scope |
| --- | --- | --- |
| dynamic-executive-roster v1 | Records the confirmed roster, replacement, relevance routing, two-person staging and permission-preset requirements. Keeps unresolved policy choices explicit. | Prompt and repo references checked; implementation and acceptance runs are future work. |
| nextjs-bot-customization v1 | Standalone implementation prompt with a conditional Vite migration and independent CTO/CFO/COO profile edits | Repo paths checked; UI, persistence and model checks specified for the implementing agent, not claimed as results |
| v2 cards | Boardroom now targets file-backed SQLite; new storage card covers migrations, seed receipts and persistence tests. The v1 boardroom card describes the archived PostgreSQL implementation. Contract and turn fixture unchanged. | Offline assembly and SQLite integration tests |
| v1 | Initial implementation contract and boardroom, scene, turn and knowledge cards; `pilot-v1` four-turn cycle plus addressed follow-up | Offline assembly tests; synthetic reference expectations. No production-model or device-quality claim. |
