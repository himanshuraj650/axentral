import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;
const usePersistentStorage = process.env.ALLOW_PERSISTENT_ROOM_STORAGE === "true";

if (usePersistentStorage && !process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set when ALLOW_PERSISTENT_ROOM_STORAGE=true.",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL || "postgresql://localhost:5432/postgres" });
export const db = drizzle(pool, { schema });