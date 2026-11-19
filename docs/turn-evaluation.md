# Evaluate an executive turn, not just a successful HTTP request

**Output under test:** the raw assistant content from `generateExecutiveDeliberationTurn`'s live completion should be **one JSON object**, without Markdown. A coding agent's handoff is Markdown; an executive's reply to the application is not. [The v1 synthetic fixture](../prompts/v1/turn-fixture.json) contains inputs, expected plans and one acceptable raw CFO reply. Use it as a shape/grounding example, not a string to match.

| Raw key | v1 quality gate |
| --- | --- |
| `dialogue` | 2–4 spoken sentences to the **planned listener**, answering the directive or latest follow-up from the speaker's discipline |
| `knowledgeTopic` / `knowledgeInsight` | 4–8 word title / 1–2 actionable sentences; one reusable insight |
| `knowledgeCategory` | `architecture` (CTO), `finance` (CFO), `operations` (COO), or `cross-functional` for consensus |
| `confidenceScore` / `tags` | Integer 70–99 / three nonempty string tags for this fixture |

`modelUsed` and `providerMode` are added by the server. In the step response the dialogue is `message.content`; the insight and category are `knowledgeEntry.insight` and `.category`. Do not ask the model for route response fields, a movement plan or its private reasoning.

## Why evaluate the raw reply?

`src/lib/opencode.ts` sends OpenAI-compatible `POST /chat/completions`. The saved per-role model wins over its profile default; the transport strips `opencode/`. The saved temperature is parsed and clamped to 0.1–1.2 (default 0.65). The bearer is resolved from saved key → `OPENCODE_API_KEY` → `OPENAI_API_KEY`; free IDs / `big-pickle` may try public access. The client tries the configured base and can retry the Zen base. Use an approved test environment for **all** possible destinations.

No usable live text gives rule-based `opencode-local-runtime` output, not a local LLM. Live JSON is permissively parsed and missing fields can be filled from that synthesis. Unparseable live text can be returned as dialogue with fallback metadata **and still be labeled `opencode-live`**. The config modal's connection test checks reachability, not dialogue quality. To score raw format, inspect the assistant content at the `liveRaw` boundary in a synthetic test/debugger before parsing. Do not add production prompt/response logging.

## Run a comparison

1. **Freeze the experiment.** State the prompt ID/revision and hypothesis (e.g. “asking the CFO to label thresholds reduces unsupported savings claims”). Read the active `ctoModel` / `cfoModel` / `cooModel`, `temperature` and `walkTalkRounds` from `GET /api/opencode-config` in the authorized deployment; record the effective settings, provider and token limit, **not** credentials. Use those settings in a disposable environment; a picker label is not proof of the model used. Only synthetic documents, recall and persona may be present. For A/B, freeze the input to `generateExecutiveDeliberationTurn` per case and replay the same transcript, plan and grounding blocks for both versions. Simply starting a new session does not reset cross-session recall.
2. **Exercise the fixture.** With four rounds in the test config, submit `session` to `POST /api/sessions`. Using its returned `session.id`, post `{sessionId}` to `/api/deliberate/step` four times. Compare each `currentPlan` with the corresponding `cycle` entry (category comes from the generated insight, not the plan). Submit `followUp` plus that `sessionId` to `/api/ceo-message`, then run one step: CFO must address CEO in `ceo-briefing`, not restart with CTO. In the UI, paste `session.ceoQuestion` as a new directive; with auto off the UI runs the first step for you.
3. **Score both versions.** Repeat each fixed-input case at least three times per version on the actual model/temperature. Check `JSON.parse(raw)` without repair, the fields above, correct addressee, use of the pilot constraints, and no invented *measured* ROI/savings. For consensus require one shared decision with a technical measure, a funding gate and an operations owner. For the CFO follow-up require one explicit release gate and acknowledgment of the missing baseline. A different wording that passes these tests is a pass. Record format and content separately; require all trials to pass before calling a candidate validated on this fixture.
4. **Exercise failure separately.** With provider egress blocked in the disposable environment, repeat a step. Require `opencode-local-runtime`, a persisted message/note and a usable `nextPlan`. Also check malformed *live* text in a stubbed transport; record salvage separately from valid raw JSON. Neither fallback nor a stub is a production-model pass. If no approved endpoint/actual configuration is available, record **live: not run**.

| Prompt ID / rev | Case × trial | Effective model / temp | Mode / latency ms | Raw JSON | Grounding / role / gate | Pass, fail reason or not run |
| --- | --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | — | — |

Other prompt surfaces have different contracts: `refineWithOpencode` in `src/lib/memory.ts` uses the COO model for persona JSON; `autoClassifyDocument` in `src/lib/enterprise-taxonomy.ts` uses the CTO model for SKOS tags/entities/relationships; `retrieveEnterpriseKnowledge` in `src/lib/enterprise-knowledge.ts` can use the CTO model for prose with document citations. Do not apply the turn JSON schema to them.
