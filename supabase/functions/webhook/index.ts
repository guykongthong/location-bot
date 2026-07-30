import { verifySignature } from "../_shared/line.ts";
import { createDb } from "../_shared/db.ts";

const LINE_CHANNEL_SECRET = Deno.env.get("LINE_CHANNEL_SECRET")!;
const db = createDb(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-line-signature");
  const valid = await verifySignature(rawBody, signature, LINE_CHANNEL_SECRET);
  if (!valid) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const payload = JSON.parse(rawBody);
  const events = payload.events || [];

  for (const event of events) {
    const source = event.source || {};
    const recipientId = source.groupId || source.roomId || source.userId;
    if (!recipientId) continue;

    if (event.type === "follow" || event.type === "join") {
      await db.upsertRecipient(recipientId);
      console.log(`Recipient added: ${recipientId}`);
    } else if (event.type === "unfollow" || event.type === "leave") {
      await db.deactivateRecipient(recipientId);
      console.log(`Recipient deactivated: ${recipientId}`);
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
