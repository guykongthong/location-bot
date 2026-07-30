import { handleArrived } from "../_shared/arrivedHandler.ts";
import { createDb } from "../_shared/db.ts";
import { checkSecret } from "../_shared/auth.ts";
import { pushMessage } from "../_shared/line.ts";

const TRIGGER_SECRET = Deno.env.get("TRIGGER_SECRET")!;
const LINE_CHANNEL_ACCESS_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")!;
const UNI_MESSAGE = Deno.env.get("UNI_MESSAGE") || "คุณกายถึงมหาลัยแล้ว";
const db = createDb(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  if (!checkSecret(req, TRIGGER_SECRET)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = await handleArrived(
    { db, pushMessage, accessToken: LINE_CHANNEL_ACCESS_TOKEN, now: () => Date.now() },
    UNI_MESSAGE,
    "last_trigger_uni",
  );

  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { "Content-Type": "application/json" },
  });
});
