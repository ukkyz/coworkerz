// Match Next.js .env/.env.local precedence when running DB tools outside Next.
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
