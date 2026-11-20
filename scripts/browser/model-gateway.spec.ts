import { test, expect as baseExpect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GO_BASE, CONSOLE_BASE } from "../../src/lib/gateway-endpoints";
import { serve } from "./serve";

const expect = baseExpect.configure({ timeout: 15_000 });
test.use({
  viewport: { width: 375, height: 740 },
  launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
});

test("test and save Go, Console and custom gateway drafts without transferring credentials", async ({
  page,
  request,
}, info) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  const dir = mkdtempSync(join(tmpdir(), "coworkerz-plan-ui-"));
  const custom = "https://profile-test.invalid/v1";
  const env = {
    ...process.env,
    NODE_ENV: "production" as const,
    DATABASE_URL: join(dir, "suite.sqlite"),
    MEMORY_DIR: join(dir, "memory"),
    KNOWLEDGE_DIR: join(dir, "knowledge"),
    NEXT_TELEMETRY_DISABLED: "1",
    OPENCODE_BASE_URL: custom,
    OPENCODE_API_KEY: "",
    OPENAI_API_KEY: "",
    OPENCODE_OFFLINE: "0",
    TEST_GATEWAY_PLANS: "1",
    OPENCODE_HEADER_RULES: "{}",
  };
  let server: Awaited<ReturnType<typeof serve>> | undefined;
  try {
    const npm = process.env.npm_execpath;
    execFileSync(npm ? process.execPath : "npm", [...(npm ? [npm] : []), "run", "db:setup"], {
      env,
      stdio: "pipe",
    });
    server = await serve(env);
    const config = async () =>
      (await (await request.get(`${server!.url}/api/opencode-config`)).json()).config;
    await page.goto(server.url);
    const open = page.getByRole("button", { name: "OpenCode API" });
    await expect(open).toBeEnabled();
    await open.press("Enter");
    const dialog = page.getByRole("dialog", { name: "OpenCode AI Model API Configuration" });
    await expect(dialog).toBeVisible();
    const base = dialog.getByLabel("Gateway base URL"),
      key = dialog.getByLabel("Gateway API key (server-side)");
    const probe = dialog.getByRole("button", { name: "Test gateway" });
    const result = dialog.getByRole("status");
    await dialog.getByRole("button", { name: "Go", exact: true }).press("Enter");
    await expect(base).toHaveValue(GO_BASE);
    await probe.press("Enter");
    await expect(result).toContainText("Set a workspace API key");
    await key.fill(randomUUID()); // ephemeral fixture key; no public network transport in this server
    await probe.click();
    await expect(result).toContainText("HTTP 403");
    await dialog.getByLabel("CTO model ID").fill("opencode-go/kimi-k3");
    await probe.click();
    await expect(result).toContainText("Live gateway returned a completion");
    expect((await config()).baseUrl).toBe(custom); // test did not save the draft
    const audit = await new AxeBuilder({ page })
      .include("dialog")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    await info.attach("gateway-dialog-accessibility", {
      body: JSON.stringify({
        passes: audit.passes.length,
        violations: audit.violations.map((r) => r.id),
        incomplete: audit.incomplete.map((r) => r.id),
      }),
      contentType: "application/json",
    });
    expect(
      audit.violations.map((r) => ({ id: r.id, targets: r.nodes.map((n) => n.target) })),
    ).toEqual([]);
    await dialog.getByRole("button", { name: "Save Configuration" }).click();
    await expect(dialog.getByText("Saved to DB")).toBeVisible();
    expect((await config()).baseUrl).toBe(GO_BASE);
    await dialog.getByRole("button", { name: "Console", exact: true }).press("Enter");
    await expect(base).toHaveValue(CONSOLE_BASE);
    await probe.click();
    await expect(result).toContainText("Set a workspace API key"); // saved Go key stayed put
    await key.fill(randomUUID());
    await probe.click();
    await expect(result).toContainText("Live gateway returned a completion");
    await base.fill(custom);
    await expect(key).toHaveValue("");
    await probe.click();
    await expect(result).toContainText("Live gateway returned a completion");
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(open).toBeFocused();

    // Two actual persisted turns share the conversation ID, not the ID of the diagnostic.
    const post = async (path: string, data: object) => {
      const res = await request.post(`${server!.url}/api/${path}`, { data });
      await expect(res).toBeOK();
      return res.json();
    };
    const { session } = await post("sessions", {
      ceoQuestion: "Which pilot baseline is missing?",
      targetRole: "CTO",
      autoWalkAndTalk: false,
    });
    expect((await post("deliberate/step", { sessionId: session.id })).message.providerMode).toBe(
      "opencode-live",
    ); // stub
    await post("ceo-message", {
      sessionId: session.id,
      targetRole: "CTO",
      content: "Which baseline comes first?",
    });
    expect((await post("deliberate/step", { sessionId: session.id })).message.providerMode).toBe(
      "opencode-live",
    );
    await expect.poll(() => server!.turns.length).toBe(2);
    const [first, second] = server.turns;
    expect(first.routingId).toMatch(/^ses_[0-9a-f]{32}$/);
    expect(second.routingId).toBe(first.routingId);
    await post("ceo-message", {
      sessionId: session.id,
      targetRole: "CFO",
      content: "Which pilot budget?",
    });
    const denied = await post("deliberate/step", { sessionId: session.id });
    expect(denied.message.providerMode).toBe("opencode-local-runtime"); // denial for the fixture's unentitled model
  } finally {
    await server?.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
