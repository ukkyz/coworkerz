import { db } from "@/db";
import { sql } from "drizzle-orm";
import { authMode, MIN_SECRET_LENGTH, SESSION_SECRET_ENV, CEO_ACCESS_CODE_ENV } from "@/lib/health";

export const dynamic = "force-dynamic";

/**
 * The only anonymous endpoint. It reports readiness without disclosing any secret, so an
 * operator (or a load balancer) can tell a database fault from an unconfigured deployment.
 */
export async function GET() {
  const mode = authMode();
  const database = (() => {
    try {
      db.get(sql`select 1`);
      return true;
    } catch {
      return false;
    }
  })();

  const auth =
    mode === "session"
      ? { mode, ready: true }
      : {
          mode,
          ready: false,
          remediation:
            mode === "disabled"
              ? "Remove CW_AUTH_DISABLED; it is only honoured outside production."
              : `Set ${SESSION_SECRET_ENV} to at least ${MIN_SECRET_LENGTH} characters and ${CEO_ACCESS_CODE_ENV} to a sign-in code.`,
        };

  const ready = database && auth.ready;
  return Response.json({ ok: ready, database, auth }, { status: ready ? 200 : 503 });
}
