import "./scripts/load-env";
import { defineConfig } from "drizzle-kit";
import { databaseFile } from "./src/db/location";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: databaseFile() },
});
