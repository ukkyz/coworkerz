import { test, expect } from "@playwright/test";
import { execFileSync, fork } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pilot from "../../prompts/v1/turn-fixture.json";

const maya = { displayName: "Maya Santoso", job: "Pilot Funding Adviser", skillPrompt: "Identify the budget cap and propose one measurable release gate." };
interface TurnRequest { type: "turn"; model: string; temperature: number; messages: { role: string; content: string }[] }

// Each start is a fresh Node process. The SQLite file (not JS state) spans restarts.
async function serve(env: NodeJS.ProcessEnv) {
  const child = fork("scripts/browser/profile-server.mjs", [], { env, execArgv: [] });
  const turns: TurnRequest[] = [];
  const exited = once(child, "exit");
  const ready = new Promise<string>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`Fixture exited (${code})`)));
    child.on("message", (msg: TurnRequest | { type: "ready"; port: number }) => {
      if (msg.type === "ready") resolve(`http://127.0.0.1:${msg.port}`);
      else turns.push(msg);
    });
  });
  return { url: await ready, turns, stop: async () => { if (child.connected) child.disconnect(); await exited; } };
}

test.use({
  viewport: { width: 1024, height: 720 },
  launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
});

test("CEO edits only the CFO; the UI and subsequent turns use the persisted identity", async ({ page, request }) => {
  test.setTimeout(180_000);
  const dir = mkdtempSync(join(tmpdir(), "coworkerz-profile-ui-"));
  const env = { ...process.env, NODE_ENV: "production" as const, NEXT_TELEMETRY_DISABLED: "1", DATABASE_URL: join(dir, "suite.sqlite"),
    MEMORY_DIR: join(dir, "memory"), KNOWLEDGE_DIR: join(dir, "knowledge"), OPENCODE_BASE_URL: "https://profile-test.invalid/v1", OPENCODE_API_KEY: "", OPENAI_API_KEY: "" };
  let server: Awaited<ReturnType<typeof serve>> | undefined;
  try {
    const npm = process.env.npm_execpath;
    execFileSync(npm ? process.execPath : "npm", [...(npm ? [npm] : []), "run", "db:setup"], { env, stdio: "pipe" });
    server = await serve(env);
    const readProfiles = async () => (await (await request.get(`${server!.url}/api/executive-profiles`)).json()).profiles;
    const before = await readProfiles();
    await page.goto(server.url);
    const canvas = await page.locator("canvas").elementHandle();
    await page.getByRole("button", { name: "CFO", exact: true }).click();
    const open = page.getByRole("button", { name: "Customize bots" });
    const dialog = page.getByRole("dialog", { name: "Customize bots" });
    const name = dialog.getByLabel("Display name");
    const job = dialog.getByLabel("Job", { exact: true });
    const skills = dialog.getByLabel("AI skill prompt");
    const save = dialog.getByRole("button", { name: "Save", exact: true });
    await open.press("Enter");
    await expect(dialog.getByLabel("Executive role")).toHaveValue("CFO");
    await name.fill("  ");
    await save.click();
    await expect(name).toBeFocused();
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await name.fill(maya.displayName);
    await job.fill(maya.job);
    await skills.fill(maya.skillPrompt);
    await page.route("**/api/executive-profiles/CFO", (route) => route.fulfill({ status: 503, json: { error: "Temporary save failure" } }), { times: 1 });
    await save.click();
    await expect(dialog.getByRole("alert")).toHaveText("Temporary save failure");
    await expect(skills).toHaveValue(maya.skillPrompt);
    expect(await readProfiles()).toEqual(before);
    await save.click();
    await expect(dialog.getByRole("status")).toContainText("CFO profile saved");
    expect(await canvas!.evaluate((el) => el.isConnected && el === document.querySelector("canvas"))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(open).toBeFocused();
    const plate = page.getByRole("button", { name: `View ${maya.displayName}, ${maya.job} (CFO)`, exact: true });
    await expect(plate).toContainText(maya.displayName);
    await expect(page.getByRole("heading", { name: maya.displayName })).toBeVisible();
    await expect(page.locator("aside").getByText(maya.displayName, { exact: true }).first()).toBeVisible();
    expect(await readProfiles()).toEqual({ ...before, CFO: maya });

    await page.setViewportSize({ width: 375, height: 740 });
    await page.reload();
    await expect(plate).toContainText(maya.job);
    await open.click();
    await dialog.getByLabel("Executive role").selectOption("CFO");
    await expect(name).toHaveValue(maya.displayName);
    await expect(dialog.getByLabel("Job", { exact: true })).toHaveValue(maya.job);
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().right <= 375)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await dialog.getByRole("button", { name: "Restore defaults" }).click();
    await expect(name).toHaveValue(before.CFO.displayName);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(open).toBeFocused();
    expect((await readProfiles()).CFO).toEqual(maya); // draft-only reset

    await server.stop();
    server = await serve(env);
    await page.goto(server.url);
    await expect(plate).toContainText(maya.displayName);
    expect(await readProfiles()).toEqual({ ...before, CFO: maya });
    const post = async (path: string, data: object) => {
      const res = await request.post(`${server!.url}/api/${path}`, { data });
      await expect(res).toBeOK();
      return res.json();
    };
    const { session } = await post("sessions", pilot.session);
    for (const role of ["CFO", "CTO"] as const) {
      const { nextPlan } = await post("ceo-message", { sessionId: session.id, content: pilot.followUp.content, targetRole: role });
      const { message, currentPlan } = await post("deliberate/step", { sessionId: session.id });
      expect(currentPlan).toEqual(nextPlan);
      expect([message.senderRole, message.targetRole]).toEqual([role, "CEO"]);
      expect(message.providerMode).toBe("opencode-live"); // parsed stub completion, NOT a real model
    }
    expect(server.turns).toHaveLength(2);
    const [cfo, cto] = server.turns;
    const { config } = await (await request.get(`${server.url}/api/opencode-config`)).json();
    expect([cfo.model, cto.model]).toEqual([config.cfoModel, config.ctoModel].map((id) => id.replace(/^opencode\//, "")));
    expect([cfo.temperature, cto.temperature]).toEqual([Number(config.temperature), Number(config.temperature)]);
    expect(cfo.messages[1].content).toContain(JSON.stringify(maya));
    expect(cfo.messages[0].content).not.toContain(maya.skillPrompt);
    expect(cto.messages[1].content).toContain(JSON.stringify(before.CTO));
    expect(JSON.stringify(cto.messages)).not.toContain(maya.skillPrompt);
    for (const turn of server.turns) {
      const system = turn.messages[0].content;
      const shape = JSON.parse(system.slice(system.lastIndexOf("\n{") + 1));
      expect(Object.keys(shape).sort()).toEqual(Object.keys(pilot.exampleRawFollowUp).sort());
    }
    const board = await (await request.get(`${server.url}/api/boardroom?sessionId=${session.id}`)).json();
    expect(board.messages.filter((m: { senderRole: string }) => m.senderRole !== "CEO").map((m: { senderRole: string; targetRole: string }) => [m.senderRole, m.targetRole])).toEqual([["CFO", "CEO"], ["CTO", "CEO"]]);

    await open.click();
    await dialog.getByLabel("Executive role").selectOption("CFO");
    await dialog.getByRole("button", { name: "Restore defaults" }).click();
    await save.click();
    await expect(dialog.getByRole("status")).toContainText("CFO profile saved");
    expect(await readProfiles()).toEqual(before);
  } finally {
    await server?.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
