import { createDb } from "../_shared/db.ts";

const db = createDb(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (_req) => {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [activeRecipients, monthlyMessageCount] = await Promise.all([
    db.activeCount(),
    db.monthlyCount(yearMonth),
  ]);

  return new Response(
    JSON.stringify({ status: "ok", activeRecipients, monthlyMessageCount }),
    { headers: { "Content-Type": "application/json" } },
  );
});
