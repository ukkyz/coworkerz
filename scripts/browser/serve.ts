import { fork } from "node:child_process";
import { once } from "node:events";
interface TurnRequest {
  type: "turn";
  model: string;
  temperature: number;
  messages: { role: string; content: string }[];
}

// Each start is a fresh Node process. The SQLite file (not JS state) spans restarts.
export async function serve(env: NodeJS.ProcessEnv) {
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
  return {
    url: await ready,
    turns,
    stop: async () => {
      if (child.connected) child.disconnect();
      await exited;
    },
  };
}
