import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createDb } from "./db.ts";

const SUPABASE_URL = Deno.env.get("TEST_SUPABASE_URL") ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = Deno.env.get("TEST_SUPABASE_SERVICE_ROLE_KEY");

if (!SERVICE_ROLE_KEY) {
  throw new Error(
    "Set TEST_SUPABASE_SERVICE_ROLE_KEY (from `supabase status`) to run db.test.ts",
  );
}

Deno.test("recipient lifecycle: upsert, list, deactivate, delete", async () => {
  const db = createDb(SUPABASE_URL, SERVICE_ROLE_KEY!);

  await db.upsertRecipient("Utest1");
  assertEquals(await db.getActiveRecipients(), ["Utest1"]);
  assertEquals((await db.getAllRecipients()).map((r) => r.user_id), ["Utest1"]);
  assertEquals(await db.activeCount(), 1);

  await db.deactivateRecipient("Utest1");
  assertEquals(await db.getActiveRecipients(), []);
  assertEquals(await db.activeCount(), 0);

  await db.upsertRecipient("Utest1");
  const deleted = await db.deleteRecipient("Utest1");
  assertEquals(deleted, 1);
  assertEquals(await db.getActiveRecipients(), []);

  const deletedAgain = await db.deleteRecipient("Utest1");
  assertEquals(deletedAgain, 0);
});

Deno.test("message log and monthly count", async () => {
  const db = createDb(SUPABASE_URL, SERVICE_ROLE_KEY!);

  await db.logMessage("Utest2");
  await db.logMessage("Utest2");

  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const count = await db.monthlyCount(yearMonth);
  assertEquals(count >= 2, true);

  const farFuture = "2099-01";
  assertEquals(await db.monthlyCount(farFuture), 0);
});

Deno.test("config get/set", async () => {
  const db = createDb(SUPABASE_URL, SERVICE_ROLE_KEY!);

  assertEquals(await db.getConfig("nonexistent_key"), null);

  await db.setConfig("last_trigger_home", "1234567890");
  assertEquals(await db.getConfig("last_trigger_home"), "1234567890");

  await db.setConfig("last_trigger_home", "9999999999");
  assertEquals(await db.getConfig("last_trigger_home"), "9999999999");
});
