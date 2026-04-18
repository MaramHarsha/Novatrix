-- Optional: align old Session rows with new defaults (dual profile + bridge).
-- Review before running in production. Then:
--   npx prisma db push   (after schema change) may be enough without this file.

UPDATE "Session" SET "sandboxEnableExegol" = true WHERE "sandboxEnableExegol" = false;

-- Only where network was never set (inherit from env); skip if you rely on explicit "none" via NULL:
-- UPDATE "Session" SET "sandboxDockerNetwork" = 'bridge' WHERE "sandboxDockerNetwork" IS NULL;
