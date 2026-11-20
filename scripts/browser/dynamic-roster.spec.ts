import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../../src/db/schema";
import { isActive, type Executive } from "../../src/lib/roster";
import { populateLegacySuite } from "../fixtures/legacy-suite";
import { pilotLead, productHead, marker, oldReply, priorCfo } from "../fixtures/roster-cases";
import { serve } from "./serve";
import fixture from "../../prompts/v1/turn-fixture.json";

test.use({
  viewport: { width: 375, height: 740 },
  launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
});
test("add, address, replace, archive and reopen a live roster at 375px", async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const dir = mkdtempSync(join(tmpdir(), "cw-roster-browser-")),
    file = join(dir, "suite.sqlite");
  const db = drizzle(new Database(file), { schema });
  const legacy = populateLegacySuite(db, dir);
  migrate(db, { migrationsFolder: "drizzle" });
  db.$client.close();
  const env = {
    ...process.env,
    NODE_ENV: "production" as const,
    NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL: file,
    MEMORY_DIR: join(dir, "memory"),
    KNOWLEDGE_DIR: join(dir, "knowledge"),
    OPENCODE_BASE_URL: "https://profile-test.invalid/v1",
    OPENCODE_API_KEY: "",
    OPENAI_API_KEY: "",
  };
  let server = await serve(env);
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  try {
    const url = (p: string) => `${server.url}/api/${p}`;
    const roster = async (): Promise<Executive[]> =>
      (await (await request.get(url("executive-profiles"))).json()).roster;
    const api = async (path: string, data: object) => {
      const res = await request.post(url(path), { data });
      await expect(res).toBeOK();
      return res.json();
    };
    const sessionId = legacy.session.id;
    const direct = async (targetRole: string, content: string) => {
      const { nextPlan } = await api("ceo-message", { sessionId, targetRole, content });
      const step = await api("deliberate/step", { sessionId });
      expect(step.currentPlan).toEqual(nextPlan);
      expect(step.message.senderRole).toEqual(nextPlan.speaker);
      return step;
    };
    const open = page.getByRole("button", { name: "Customize bots" }),
      dialog = page.getByRole("dialog", { name: "Customize bots" });
    const recipient = page.getByLabel("Message recipient"),
      selector = page.getByLabel("Select executive", { exact: true });
    const fill = async (e: typeof pilotLead) => {
      await dialog.getByLabel("Display name").fill(e.displayName);
      await dialog.getByLabel("Job", { exact: true }).fill(e.job);
      await dialog.getByLabel("AI skill prompt").fill(e.skillPrompt);
      await dialog.getByLabel("Model ID").fill(e.model);
    };
    await page.goto(server.url);
    await expect(recipient).toBeVisible();
    const stage = page.locator("[data-onstage]");
    await expect(stage).toHaveCount(1);
    await expect(stage).toHaveAttribute("data-onstage", "CFO");
    const canvas = await page.locator("canvas").elementHandle();
    expect(canvas).not.toBeNull();
    await page.getByTitle(/Toggle automatic/).click(); // no unattended follow-up calls
    await open.press("Enter");
    await dialog.getByRole("button", { name: "Add executive", exact: true }).press("Enter");
    await dialog.getByLabel("Role title").fill(pilotLead.roleName);
    await fill(pilotLead);
    await dialog.getByRole("button", { name: "Create executive" }).press("Enter");
    await expect(dialog.getByLabel("Enterprise access")).toBeFocused();
    await expect(dialog.getByRole("alert")).toContainText("select");
    await dialog.getByLabel("Enterprise access").selectOption("internal");
    await dialog.getByRole("button", { name: "Create executive" }).press("Enter");
    await expect(dialog.getByRole("status")).toContainText("Pilot Readiness Lead added");
    expect(
      await dialog.evaluate(
        (el) => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().right <= 375,
      ),
    ).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    const audit = await new AxeBuilder({ page })
      .include("dialog")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    await test
      .info()
      .attach("dialog-accessibility", {
        body: JSON.stringify({
          passes: audit.passes.length,
          incomplete: audit.incomplete.map((r) => r.id),
          violations: audit.violations.map((r) => r.id),
        }),
        contentType: "application/json",
      });
    expect(audit.violations.map((r) => r.id)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(open).toBeFocused();
    const members = await roster(),
      lead = members.find((e) => e.roleName === pilotLead.roleName)!;
    expect(members.filter(isActive)).toHaveLength(4);
    expect(lead.id).toMatch(/^exec-/);
    await selector.selectOption(lead.id);
    await expect(page.getByRole("heading", { name: "Ari", exact: true })).toBeVisible();
    await expect(stage).toHaveCount(1);
    await expect(stage).toHaveAttribute("data-onstage", "CFO"); // selection doesn't allocate an actor
    expect(
      await canvas!.evaluate((el) => el.isConnected && el === document.querySelector("canvas")),
    ).toBe(true);
    await page.getByRole("button", { name: "OpenCode API" }).click();
    const assign = page.getByLabel("Pilot Readiness Lead model ID");
    await expect(assign).toHaveValue(pilotLead.model);
    await assign.fill("opencode/readiness-verified-free");
    await page.getByRole("button", { name: "Save Configuration" }).click();
    await expect(page.getByText("Saved to DB")).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await recipient.selectOption(lead.id);
    await page.getByLabel("CEO question").fill("What should we measure first?");
    const reply = page.waitForResponse(
      (r) => r.url().endsWith("/api/deliberate/step") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Ask C-Suite" }).press("Enter");
    const first = await (await reply).json();
    expect(first.message.senderRole).toBe(lead.id);
    expect(first.message.targetRole).toBe("CEO");
    await expect(stage).toHaveCount(1);
    await expect(stage).toHaveAttribute("data-onstage", lead.id);
    const team = "Who owns rehearsal signoffs and amber checklists?";
    expect((await direct("ALL", team)).message.senderRole).toBe(lead.id);
    expect((await direct("CTO", "Which technical trial?")).message.senderRole).toBe("CTO");
    expect((await direct("CFO", "Can we fund it?")).message.senderRole).toBe("CFO");
    const [leadCall, teamCall, peerCall, cfoCall] = server.turns;
    for (const turn of [leadCall, teamCall]) {
      expect(turn.temperature).toBe(0.42);
      expect(turn.model).toBe("readiness-verified-free");
      expect(turn.messages[1].content).toContain(pilotLead.skillPrompt);
      expect(turn.messages[1].content).toContain(oldReply);
      expect(turn.messages[1].content).not.toContain(marker);
      expect(turn.messages[1].content).not.toContain(priorCfo.skillPrompt);
      expect(Object.keys(JSON.parse(turn.messages[0].content.split("\n").at(-1)!)).sort()).toEqual(
        Object.keys(fixture.exampleRawFollowUp).sort(),
      );
    }
    expect(peerCall.messages[1].content).not.toContain(pilotLead.skillPrompt);
    expect(cfoCall.model).toBe("original-finance-free");
    expect(cfoCall.messages[1].content).toContain(marker);

    await open.click();
    await dialog.getByLabel("Executive role").selectOption("CFO");
    await dialog.getByRole("button", { name: "Replace executive", exact: true }).click();
    await expect(dialog.getByText(/separate identity, empty personal recall/)).toBeVisible();
    await expect(dialog.getByLabel("Enterprise access")).toHaveValue("");
    await dialog.getByLabel("Suggested role").selectOption(productHead.roleName);
    await fill(productHead);
    await dialog.getByLabel("Enterprise access").selectOption("confidential");
    await dialog.getByRole("button", { name: "Confirm replacement" }).click();
    await expect(dialog.getByRole("status")).toContainText("CFO archived");
    const product = (await roster()).find((e) => e.roleName === productHead.roleName)!;
    expect(product.id).not.toBe("CFO");
    await dialog.getByLabel("Executive role").selectOption("COO");
    await dialog.getByRole("button", { name: "Remove executive", exact: true }).click();
    await dialog.getByRole("button", { name: "Confirm removal" }).click();
    await expect(dialog.getByRole("status")).toContainText("COO archived");
    await page.keyboard.press("Escape");
    const allowed = await api("v1/enterprise/documents", {
      title: "Product milestone",
      domainKey: "operations",
      content: "Synthetic discovery fixture for the product milestone.",
      classificationLevel: "confidential",
      aclReadRoles: [product.id],
      autoApprove: true,
      extractGraph: false,
    });
    const node = await api("v1/enterprise/graph", {
      kind: "entity",
      name: "Product milestone node",
      domainKey: "operations",
      classificationLevel: "confidential",
      aclReadRoles: [product.id],
    });
    const checkPersistence = async () => {
      const current = await roster();
      expect(current.filter(isActive).map((e) => e.id)).toEqual(["CTO", lead.id, product.id]);
      const archived = current.find((e) => e.id === "CFO")!;
      expect(archived.retiredAfter).not.toBeNull();
      expect(archived.displayName).toBe(priorCfo.displayName);
      await expect(recipient.locator(`option[value="${lead.id}"]`)).toHaveText(
        /Pilot Readiness Lead/,
      );
      await expect(recipient.locator('option[value="CFO"]')).toHaveCount(0);
      const board = await (await request.get(url(`boardroom?sessionId=${sessionId}`))).json();
      expect(board.messages.find((m: { id: number }) => m.id === legacy.reply.id)).toMatchObject({
        senderRole: "CFO",
        content: oldReply,
      });
      const journal = async (id: string) =>
        (await request.get(url(`memory/file?path=executives/${id}.md`))).text();
      expect(await journal("CFO")).toContain(marker);
      expect(await journal(product.id)).not.toContain(marker);
      for (const stale of ["CFO", "COO"]) {
        expect(
          (
            await request.post(url("ceo-message"), {
              data: { targetRole: stale, sessionId, content: "Still here?" },
            })
          ).status(),
        ).toBe(409);
        expect((await request.get(url(`v1/enterprise/documents?asRole=${stale}`))).status()).toBe(
          401,
        );
      }
      expect(
        (
          await request.get(url(`v1/enterprise/documents/${legacy.doc.id}?asRole=${product.id}`))
        ).status(),
      ).toBe(403);
      await expect(
        await request.get(
          url(`v1/enterprise/documents/${allowed.document.id}?asRole=${product.id}`),
        ),
      ).toBeOK();
      const graph = await (
        await request.get(url(`v1/enterprise/graph?asRole=${product.id}`))
      ).json();
      expect(graph.entities.map((e: { id: number }) => e.id)).toContain(node.entity.id);
      expect(graph.entities.map((e: { id: number }) => e.id)).not.toContain(legacy.entity.id);
      expect((await direct(product.id, "How can we test discovery?")).message.modelUsed).toBe(
        productHead.model,
      );
      const productCall = server.turns.at(-1)!;
      expect(productCall.messages[1].content).not.toContain(marker);
      expect(productCall.messages[1].content).not.toContain(priorCfo.skillPrompt);
      expect((await direct("ALL", team)).message.senderRole).toBe(lead.id);
    };
    await page.reload();
    await checkPersistence();
    await server.stop();
    server = await serve(env);
    await page.goto(server.url);
    await checkPersistence();
    await open.click();
    await dialog.getByText("Archived executives (2)").click();
    await expect(dialog.getByRole("link", { name: /CFO · Maya Santoso/ })).toHaveAttribute(
      "href",
      "/api/memory/file?path=executives/CFO.md",
    );
    await page.keyboard.press("Escape");
    // A fresh directive can also target an ID. Peer exchanges stage exactly two distinct people.
    const newSession = await api("sessions", {
      ceoQuestion: "Test discovery milestones?",
      targetRole: product.id,
    });
    expect(newSession.firstStepPlan).toMatchObject({ speaker: product.id, listener: "CEO" });
    await api("deliberate/step", { sessionId: newSession.session.id });
    const peerExchange = await api("deliberate/step", { sessionId: newSession.session.id });
    await page.reload();
    await expect(stage).toHaveCount(2);
    expect(
      await stage.evaluateAll((els) => els.map((el) => el.getAttribute("data-onstage"))),
    ).toEqual([peerExchange.currentPlan.speaker, peerExchange.currentPlan.listener]);
    for (const e of (await roster()).filter(isActive))
      await expect(await request.delete(url(`executive-profiles/${e.id}`))).toBeOK();
    await page.reload();
    await expect(page.getByRole("alert").filter({hasText:"No active executives"})).toBeVisible();
    await expect(stage).toHaveCount(0);
    await page.getByLabel("CEO question").fill("No recipients?");
    await expect(page.getByRole("button", { name: "Ask C-Suite" })).toBeDisabled();
    await open.click();
    await expect(dialog.getByRole("button", { name: "Create executive" })).toBeEnabled();
    await expect(dialog.getByText(/Archived executives \(5\)/)).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
