# Connect Coworkerz to a model gateway

## Pick the billing endpoint explicitly

In **OpenCode API**, choose a preset or enter a custom **base URL**, not a complete inference URL. Coworkerz sends a server-side `POST` to `<base>/chat/completions` and reads `choices[0].message.content`. It does not follow redirects, change billing endpoints after an error, or translate other API families.

| Intended use | Base URL | What you need |
| --- | --- | --- |
| General boardroom use via Console | `https://opencode.ai/inference/openai/v1` | A Console workspace key and an enabled paid Chat Completions model. Console's built-in free-tier chat models are restricted to the OpenCode client. |
| Go subscription | `https://opencode.ai/inference/go/openai/v1` | A key for a subscribed workspace, an eligible model, and use consistent with the Go coding-agent plan. Headers do not confer eligibility. |
| Another provider or your own proxy | The provider's OpenAI-compatible base, often ending in `/v1` | Its model ID and supported authentication. HTTPS is required, except for local loopback HTTP servers. URLs containing credentials, queries or fragments are rejected. An invalid URL saved by an older version appears blank; enter the correct base and key. |

Select the model **as well as** the gateway. For example, if `kimi-k3` is enabled in your workspace, enter `kimi-k3` or `opencode-go/kimi-k3`. The `opencode/` and `opencode-go/` display prefixes are stripped on the wire; neither changes the destination. Other model namespaces are passed through. Old model assignments are preserved, not silently changed to billable models. Replace the demo free-tier IDs before testing a Console paid model. The transcript distinguishes **Local synthesis** from replies received from the gateway.

**Test gateway** uses the draft URL, key and first active executive's model (the configured CTO service model if the roster is empty). It sends one short, potentially billable request, not a transcript. Success requires a nonempty chat completion, not just HTTP 200. **Save Configuration** is separate. On an existing installation, back up SQLite, stop old writers, and run `npm run db:migrate` before serving this release. No reseed.

## Headers and credentials

- Coworkerz identifies itself as `User-Agent: coworkerz/1.0`. It never identifies as the OpenCode CLI or another client. JSON requests use `Content-Type: application/json`.
- On OpenCode, `x-opencode-session` is `ses_` followed by an opaque identifier. It stays the same across turns, follow-ups and session-triggered persona work for the **same conversation and gateway**, including after a server restart. It is not a request counter. Standalone operations such as diagnostics, document classification and individual retrieval requests get separate one-shot IDs. Unrelated providers do not receive this OpenCode header.
- Enter the **raw** key; the server supplies `Authorization: Bearer …`. A saved key is used only with its saved base URL. Testing another URL does not move it. Saving a changed URL without entering a new key removes the old saved key. Environment credentials can still apply.
- `OPENCODE_API_KEY` is for the official OpenCode presets by default. If `OPENCODE_BASE_URL` names a custom gateway, this key is pinned to that exact base instead. `OPENAI_API_KEY` is a fallback **only** for `https://api.openai.com/v1`. The seed uses `OPENCODE_BASE_URL` for the initial URL; existing installations select their active URL in settings.
- There is no fabricated `public` bearer. Missing credentials block OpenCode calls. Custom gateways can use another authentication header or accept anonymous requests. **Use `OPENCODE_OFFLINE=1` to disable all provider egress**, including probes, regardless of credentials. The interactive configuration API assumes a trusted CEO console, not public multi-user authentication.

## Extra headers for a provider you control or are authorized to use

Set `OPENCODE_HEADER_RULES` in the **server environment** and restart the app. It is a JSON object keyed by exact normalized gateway base URL, including port and path. A trailing slash does not create a separate scope. There is no wildcard match, browser editor, or forwarding of incoming browser headers. Keep real static values in private deployment settings, not in Git or logs.

```dotenv
OPENCODE_HEADER_RULES='{"https://gateway.example/v1":[{"name":"X-Client-Tag","type":"static","value":"cw-boardroom","prefix":"cw-"},{"name":"X-Request-ID","type":"sequence","prefix":"req_"}]}'
```

| Rule | Example on the wire | Contract |
| --- | --- | --- |
| `static` | `X-Client-Tag: cw-boardroom` | Sends the configured value unchanged. If a `prefix` is supplied, the value must already start with it (case-sensitive). |
| `sequence` | `X-Request-ID: req_1`, then `req_2` | Optional literal prefix + a decimal request number. No regexes, scripts, random rotation or template expansion. |

When a base has sequence rules, one atomic SQLite allocation is shared by those rules per outbound attempt. Diagnostics and auxiliary completions count; offline or invalid requests don't. A failed network call still uses its number. Allocation order is not a guarantee of delivery order. Migration `0004` stores only the base, an opaque routing namespace and a counter. Restarts continue the sequence; restoring or cloning a DB also restores its counter. Do not use it as a globally unique nonce or credential.

Names must be valid HTTP field names, unique ignoring case. Values must be printable ASCII with no embedded control characters; static values cannot have surrounding whitespace. Transport, credential and client-identity fields such as `Host`, `Content-Length`, `Authorization`, `User-Agent`, `Cookie` and `x-opencode-*` cannot be overridden. Invalid rules fail closed before dispatch. The UI and API responses do not expose rule values or upstream error bodies.

## Troubleshooting

| Diagnostic | Check |
| --- | --- |
| Egress disabled / missing key | Check `OPENCODE_OFFLINE`, the selected base and its scoped credential. Do not share the key in a bug report. |
| HTTP 400 or 404 | Verify the model is available at this plan's **Chat Completions** endpoint and the base does not include `/chat/completions` twice. |
| HTTP 401 / 402 / 403 | Check the credential, balance/subscription, workspace permissions, model availability and intended workload. Don't change identity headers to work around a denial. |
| HTTP 429 | Check plan usage/rate limits. There is no automatic retry on a different plan. |
| Redirect / invalid response | Use the final API base rather than a console web page or redirector. HTML or an empty completion is not a successful test. |
| Network / timeout | Check DNS, TLS and outbound access **from the app server**. Diagnostics allow 20 seconds; normal completions allow 45 seconds. Failed turns use the existing local synthesis behavior. |

**Sources:** [Go client requirements](https://opencode.ai/docs/console/go/#where-can-i-use-it), [base URLs and stable sessions](https://opencode.ai/docs/console/harnesses/#base-urls), [inference authentication](https://opencode.ai/docs/console/api/inference/#authentication). Provider policies and model catalogs can change.
