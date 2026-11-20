import { expect as baseExpect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CEO_TOPICS, type CeoRadar } from "../../src/lib/ceo-topics";
import { serve } from "./serve";

const expect = baseExpect.configure({ timeout: 15_000 });
test.use({
  viewport: { width: 375, height: 740 },
  launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
});

test("CEO previews, captures and deliberately replaces an accessible eight-topic radar", async ({
  page,
  request,
}, info) => {
  test.setTimeout(180_000);
  const dir = mkdtempSync(join(tmpdir(), "coworkerz-radar-ui-"));
  const env = {
    ...process.env,
    NODE_ENV: "production" as const,
    DATABASE_URL: join(dir, "suite.sqlite"),
    MEMORY_DIR: join(dir, "memory"),
    KNOWLEDGE_DIR: join(dir, "knowledge"),
    OPENCODE_OFFLINE: "1",
    OPENCODE_BASE_URL: "https://profile-test.invalid/v1",
    NEXT_TELEMETRY_DISABLED: "1",
  };
  let server: Awaited<ReturnType<typeof serve>> | undefined;
  try {
    const npm = process.env.npm_execpath;
    execFileSync(npm ? process.execPath : "npm", [...(npm ? [npm] : []), "run", "db:setup"], {
      env,
      stdio: "pipe",
    });
    server = await serve(env);
    const view = async (): Promise<CeoRadar> =>
      (await request.get(`${server!.url}/api/ceo-baseline`)).json();
    await page.goto(server.url);
    const open = page.getByRole("button", { name: "CEO radar", exact: true });
    const panel = page.getByRole("region", { name: "CEO knowledge baseline" });
    await page.route(
      "**/api/ceo-baseline",
      (route) => route.fulfill({ status: 503, json: { error: "Temporary read error" } }),
      { times: 1 },
    );
    await open.press("Enter");
    await expect(panel.getByRole("alert")).toHaveText("Temporary read error");
    await panel.getByRole("button", { name: "Refresh" }).press("Enter");
    await expect(panel.getByText("Unsaved preview")).toBeVisible();
    const chart = panel.getByRole("img", { name: /CEO discussion signal radar/ });
    await expect(chart).toBeVisible();
    await expect(page.getByRole("textbox", { name: "CEO question" })).toHaveCount(0); // covered mobile room is not tabbable
    await expect(chart.locator("text")).toHaveCount(8);
    const preview = await view();
    expect(preview.revision).toBe(0);
    const table = panel.getByRole("table", { name: "Topic readings" });
    for (const topic of CEO_TOPICS) {
      const row = table
        .getByRole("row")
        .filter({ has: page.getByRole("rowheader", { name: topic.name, exact: true }) });
      const reading = preview.readings[topic.id];
      await expect(row.getByRole("cell").first()).toHaveText(
        reading ? String(reading.score) : "Unobserved",
      );
    }
    expect(
      await panel.evaluate(
        (el) => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().right <= 375,
      ),
    ).toBe(true);
    const capture = panel.getByRole("button", { name: "Capture baseline" });
    await capture.press("Enter");
    await expect(panel.getByRole("status")).toContainText("Baseline saved");
    const saved = await view();
    expect(saved.readings).toEqual(preview.readings);
    expect(saved.revision).toBe(1);
    const { violations, passes, incomplete } = await new AxeBuilder({ page })
      .include("section[aria-labelledby='ceo-radar-heading']")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    await info.attach("radar-accessibility", {
      body: JSON.stringify({
        passes: passes.map((p) => p.id),
        incomplete: incomplete.map((p) => p.id),
        violations: violations.map((v) => v.id),
      }),
      contentType: "application/json",
    });
    expect(violations.map((v) => v.id)).toEqual([]);

    await page.getByTitle("Toggle Boardroom Intelligence Panel").press("Enter");
    await expect(page.getByRole("textbox", { name: "CEO question" })).toBeVisible();
    await server.stop();
    server = await serve(env);
    await page.setViewportSize({ width: 1100, height: 760 });
    await page.goto(server.url);
    await page
      .getByRole("group", { name: "Intelligence views" })
      .getByRole("button", { name: "Radar" })
      .click();
    await expect(panel.getByText("Saved baseline", { exact: true })).toBeVisible();
    await expect(panel.locator("time")).toHaveAttribute("datetime", saved.capturedAt!);
    const res = await request.post(`${server.url}/api/sessions`, {
      data: {
        ceoQuestion: "Review customer churn, pricing and operations.",
        autoWalkAndTalk: false,
      },
    });
    await expect(res).toBeOK();
    await expect(
      await request.post(`${server.url}/api/memory`, { data: { action: "rebuild" } }),
    ).toBeOK();
    expect(await view()).toEqual(saved);
    const replace = panel.getByRole("button", { name: "Replace baseline…" });
    await replace.press("Enter");
    await panel.getByRole("button", { name: "Cancel" }).press("Enter");
    await expect(replace).toBeFocused();
    expect(await view()).toEqual(saved);
    await replace.press("Enter");
    await panel.getByRole("button", { name: "Confirm replacement" }).press("Enter");
    await expect(panel.getByRole("status")).toContainText("Baseline saved");
    expect((await view()).readings.customers).toEqual({ score: 57, signals: 2 });
    expect((await view()).revision).toBe(2);
    await page.reload();
    await open.click();
    await expect(panel.getByText("Saved baseline", { exact: true })).toBeVisible();
  } finally {
    await server?.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
