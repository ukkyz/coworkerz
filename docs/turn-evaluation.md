# Evaluate an executive turn, not just a successful HTTP request

**Output under test:** the raw assistant content from `generateExecutiveDeliberationTurn`'s live completion should be **one JSON object**, without Markdown. A coding agent's handoff is Markdown; an executive's reply to the application is not. [The v1 synthetic fixture](../prompts/v1/turn-fixture.json) contains inputs, historical v1 plans and one acceptable raw CFO reply. Use it as a shape/grounding example, not a string to match.

| Raw key | v1 quality gate |
| --- | --- |
| `dialogue` | 2–4 spoken sentences to the **planned listener**, answering the directive or latest follow-up from the speaker's discipline |
| `knowledgeTopic` / `knowledgeInsight` | 4–8 word title / 1–2 actionable sentences; one reusable insight |
| `knowledgeCategory` | `architecture` (CTO), `finance` (CFO), `operations` (COO), or `cross-functional` for consensus or a custom role |
| `confidenceScore` / `tags` | Integer 70–99 / three nonempty string tags for this fixture |

`modelUsed` and `providerMode` are added by the server. In the step response the dialogue is `message.content`; the insight and category are `knowledgeEntry.insight` and `.category`. Do not ask the model for route response fields, a movement plan or its private reasoning.

## Turn prompt changelog

- **`executive-turn/v3`**: the roster planner, not a model, assigns the speaker and listener. The user message grounds the speaker with its immutable role title, editable name, job and skill; the listener contributes its label only. **Pass condition:** the same six keys, correct addressee and actionable insight, with no other member’s skill/private recall. Use `scripts/fixtures/roster-cases.ts` for the synthetic fourth role and replacement. The browser test captures v3 requests at the saved model and temperature; this is transport evidence, not a production-model evaluation.
- **`CEO persona/v2`** (`src/lib/memory.ts`): shared preferences from CEO messages only; raw JSON with `executiveSummary` and `decisionStyle`. Do not ask the model to invent observations on behalf of new executives. Direct-address observations are computed by ID. The administrative persona service keeps its configured refinement model; it does not take a boardroom turn.

- **`executive-turn/v2`** (`src/lib/opencode.ts`): the planned speaker's effective name, job and skill guidance are JSON data in the user message, not rules in the system message. Speaker, listener, retrieval scope, category and six-key output contract are still determined by the server. A listener's display name may appear; its configured skill prompt is not supplied. Fixed local synthesis uses saved names, not arbitrary skill guidance. `npm run test:profiles:ui` inspects synthetic CFO and CTO requests at a stubbed transport after restart; it does not score a production model.
- **v1** (before profile overrides): name, title and expertise came from the static cast. The `pilot-v1` fixture and raw response checks above still apply. For a live v2 comparison, pin the exact test profile as well as the model, temperature and grounding below.

## Why evaluate the raw reply?

`src/lib/opencode.ts` uses the same server-side Chat Completions transport as the gateway diagnostic. It calls only the selected base and never redirects to another billing plan. The saved per-executive model wins; `opencode/` and `opencode-go/` display prefixes are removed. Turn temperature is clamped to 0.1–1.2 (default 0.65). See [gateway setup](model-gateways.md) for workspace eligibility, credential scoping, session IDs and server-side header rules.

No usable live text gives rule-based `opencode-local-runtime` output, not a local LLM. Live JSON is permissively parsed and missing fields can be filled from that synthesis. Unparseable live text can be returned as dialogue with fallback metadata **and still be labeled `opencode-live`**. The config modal's connection test checks reachability, not dialogue quality. To score raw format, inspect the assistant content at the `liveRaw` boundary in a synthetic test/debugger before parsing. Do not add production prompt/response logging.

## Run a comparison

1. **Freeze the experiment.** State the prompt ID/revision and hypothesis (e.g. “asking the CFO to label thresholds reduces unsupported savings claims”). Read the selected `config.models[executiveId]`, `temperature` and `walkTalkRounds` from `GET /api/opencode-config` in the authorized deployment; record the effective settings, provider and token limit, **not** credentials. Use those settings in a disposable environment; a picker label is not proof of the model used. Only synthetic documents, recall and persona may be present. For A/B, freeze the input to `generateExecutiveDeliberationTurn` per case and replay the same transcript, plan and grounding blocks for both versions. Simply starting a new session does not reset cross-session recall.
2. **Exercise the fixture.** With four rounds in the test config, submit `session` to `POST /api/sessions`. Using its returned `session.id`, post `{sessionId}` to `/api/deliberate/step` four times. For v3, compare `currentPlan` with the actual live roster and latest directive, **not** the old fixed `cycle`. Verify the fourth bot answers a uniquely matching whole-team question. Submit `followUp` plus that `sessionId` to `/api/ceo-message`, then run one step: on a fixture with the original CFO still active, CFO must address CEO in `ceo-briefing`, not restart with CTO. In the UI, paste `session.ceoQuestion` as a new directive; with auto off the UI runs the first step for you.
3. **Score both versions.** Repeat each fixed-input case at least three times per version on the actual model/temperature. Check `JSON.parse(raw)` without repair, the fields above, correct addressee, use of the pilot constraints, and no invented *measured* ROI/savings. For consensus require one shared decision with a technical measure, a funding gate and an operations owner. For the CFO follow-up require one explicit release gate and acknowledgment of the missing baseline. A different wording that passes these tests is a pass. Record format and content separately; require all trials to pass before calling a candidate validated on this fixture.
4. **Exercise failure separately.** With provider egress blocked in the disposable environment, repeat a step. Require `opencode-local-runtime`, a persisted message/note and a usable `nextPlan`. Also check malformed *live* text in a stubbed transport; record salvage separately from valid raw JSON. Neither fallback nor a stub is a production-model pass. If no approved endpoint/actual configuration is available, record **live: not run**.

| Prompt ID / rev | Case × trial | Effective model / temp | Mode / latency ms | Raw JSON | Grounding / role / gate | Pass, fail reason or not run |
| --- | --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | — | — |

Other prompt surfaces have different contracts: `refineWithOpencode` in `src/lib/memory.ts` uses the COO model for persona JSON; `autoClassifyDocument` in `src/lib/enterprise-taxonomy.ts` uses the CTO model for SKOS tags/entities/relationships; `retrieveEnterpriseKnowledge` in `src/lib/enterprise-knowledge.ts` uses the caller executive’s saved model (otherwise the configured service model) for prose with document citations. Do not apply the turn JSON schema to them.
