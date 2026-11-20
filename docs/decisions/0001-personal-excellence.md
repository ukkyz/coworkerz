# ADR-001: Measure a practiced behavior, not conversation activity

**Status: Proposed, not implemented.** Proposed beneficiary: the human in the CEO seat. This is a personal learning tool, not an evaluation of employees or of the software executives.

## Project recap

Coworkerz already helps a CEO think through a decision. The CEO addresses a persisted roster; the [planner](../../src/lib/turn-planner.ts) selects the participants, and a Next.js handler saves the exchange and its insight in SQLite. The Three.js room presents the exchange; it does not own it. [Conversational memory and governed enterprise knowledge](../architecture.md#two-knowledge-planes-not-two-interchangeable-sources) serve different purposes: an executive's recollection is not an approved company document.

The gap is **after the conversation**. The [persona topic analyzer](../../src/lib/persona-topic-signals.ts) counts topic keywords in CEO messages; its score rises with those counts. Discussing budgets more often can raise the finance score without changing a single budgeting decision. Likewise, [`appliedCount`](../../src/app/api/deliberate/step/route.ts#L145-L154) increases for notes selected as context in a turn, not when the CEO acts on them. The [dashboard radar](../architecture.md#ceo-discussion-baseline) labels its snapshot as discussion coverage; neither measure is evidence of personal growth.

## Recommendation: one weekly practice card

1. **Choose.** Beside the existing [insight actions](../../src/components/ExecutiveBoardroomApp.tsx), offer **Practice this**. The CEO can also start a blank card without a session or an executive. Nothing becomes a commitment until the CEO chooses a behavior, a target and a review date.
2. **Observe.** Example: “For my next three handoffs, agree on an owner and a review date before the meeting ends.” The CEO reviews the previous three comparable handoffs: **1 of 3** met that rule. The target for this week is **3 of 3**. After each handoff the CEO records *met* or *not met*, with an optional short example. This is self-reported evidence, not independent verification.
3. **Review.** On Friday the card reads **2 of 3 met; previously 1 of 3**. The missed handoff had an owner but no date. The CEO chooses an adjustment: *ask the recipient to pick the review date before we finish*. If only two handoffs were recorded, show the third as **unobserved**, not failed. If there is no baseline, show no change estimate. Compare only periods using the same rule.

## Architectural decision and trade-offs

| Option | What it buys | What it gives up |
| --- | --- | --- |
| Chart persona scores over time | No new workflow | Measures language frequency; cannot distinguish talking about a behavior from practicing it. |
| **A practice module in the existing app** | Explicit observations; works without an LLM or an active roster | The CEO must return for a brief check-in. A self-report can still be biased. |
| Separate coaching service | Independent deployment and integrations | Adds another store and personal-data boundary before we know whether the weekly review is useful. Defer. |

For the in-app option, a **practice cycle** owns the agreed rule, baseline, target, review date and closing reflection. Its dated **check-ins** are the only inputs to observed results. Two tables in the existing SQLite file suffice. Keep measurement rules in plain TypeScript: the Next.js handler authorizes the person, the Drizzle adapter loads/saves rows, and neither framework is imported by the domain rules. No new turn-prompt fields, scene assets, scheduler or event bus.

A nullable source insight ID is provenance, not ownership: deleting the note or retiring its author must not delete the practice. Keep check-ins and reflections out of shared transcripts, executive recall, persona rebuilds, enterprise retrieval and provider requests. The [trusted local CEO console](../executive-roster.md#addressing-and-crud) is the limit for a pilot; a shared deployment needs authenticated individual owners and per-owner authorization first.

## Smallest test of value

Before building, try the card privately for two weeks with one willing CEO and one behavior. **Decision gate:** will the CEO return for a second review and use a dated example to decide what to keep or change, without rereading the transcript? A flat result and a useful adjustment count as learning; more conversations do not.

If that is useful, ship just the card, check-in and review. Acceptance example: with provider egress disabled, save two *met* and one *not met*, retry one save, and restart the app. The result must still be **2 of 3**. Rebuilding the persona or running more turns must not change it, and an executive or enterprise key must not be able to read the reflection.
