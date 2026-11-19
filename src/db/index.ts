import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { databaseFile } from "./location";
import * as schema from "./schema";

function openConnection() {
  const connection = new Database(databaseFile(), { timeout: 5000 });
  connection.pragma("foreign_keys = ON");
  connection.pragma("journal_mode = WAL");
  return connection;
}

// Reuse the native connection across Next dev module reloads.
const globalForDb = globalThis as typeof globalThis & { coworkerzSqlite?: Database.Database };
const connection = globalForDb.coworkerzSqlite ?? openConnection();
if (process.env.NODE_ENV !== "production") globalForDb.coworkerzSqlite = connection;

export type AppDatabase = BetterSQLite3Database<typeof schema>;
export const db = drizzle(connection, { schema });
export { schema };
