import { createDb } from "../_shared/db.ts";
import { checkSecret } from "../_shared/auth.ts";
import { resolveName } from "../_shared/line.ts";

const TRIGGER_SECRET = Deno.env.get("TRIGGER_SECRET")!;
const LINE_CHANNEL_ACCESS_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")!;
const db = createDb(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (!checkSecret(req, TRIGGER_SECRET)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method === "GET") {
    const recipients = await db.getAllRecipients();
    const enriched = await Promise.all(
      recipients.map(async (r) => ({
        ...r,
        name: await resolveName(LINE_CHANNEL_ACCESS_TOKEN, r.user_id),
      })),
    );
    return new Response(JSON.stringify({ count: enriched.length, recipients: enriched }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method === "DELETE") {
    const url = new URL(req.url);
    const userId = url.pathname.split("/").filter(Boolean).pop();
    if (!userId || userId === "recipients") {
      return new Response(JSON.stringify({ error: "userId required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const deleted = await db.deleteRecipient(userId);
    if (deleted === 0) {
      return new Response(JSON.stringify({ error: "Recipient not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true, userId }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response("Method Not Allowed", { status: 405 });
});
