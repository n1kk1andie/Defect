import { defineConfig } from "drizzle-kit";
// `npm run db:generate` writes the next SQL migration into drizzle/ from
// lib/db/schema.ts; scripts/embed-migrations.mjs then folds drizzle/*.sql into
// lib/db/migrations.generated.ts, which the app applies at runtime.
export default defineConfig({ dialect: "postgresql", schema: "./lib/db/schema.ts", out: "./drizzle" });
