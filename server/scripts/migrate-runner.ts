import { initSchema, migrateSchema } from "../src/db.js";

initSchema();
migrateSchema();
console.log("[migrate-runner] MIGRATION_OK");