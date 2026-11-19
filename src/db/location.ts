import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Shared by the app, Drizzle Kit and seed. Never interpret an old DB server URL as a filename. */
export function databaseFile(): string {
  const value = process.env.DATABASE_URL?.trim() || ".local/coworkerz.sqlite";
  const filename = value.startsWith("file://") ? fileURLToPath(value) : value.replace(/^file:/, "");
  if (!filename || filename === ":memory:" || /^[a-z][a-z\d+.-]*:\/\//i.test(filename) || /[?#]/.test(value)) {
    throw new Error("DATABASE_URL must point to a local SQLite file (for example .local/coworkerz.sqlite)");
  }
  const absolute = resolve(filename);
  mkdirSync(dirname(absolute), { recursive: true, mode: 0o700 });
  return absolute;
}
