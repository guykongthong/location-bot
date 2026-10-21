import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { verifySignature } from "./line.ts";

// Precomputed: printf '%s' '{"events":[]}' | openssl dgst -sha256 -hmac "testsecret" -binary | base64
const BODY = '{"events":[]}';
const SECRET = "testsecret";
const VALID_SIGNATURE = "7/zjpxmsANrs8ptIk/KkFoHlDrLSXUZV+eHj+1N7Rdg=";

Deno.test("verifySignature accepts a correct signature", async () => {
  assertEquals(await verifySignature(BODY, VALID_SIGNATURE, SECRET), true);
});

Deno.test("verifySignature rejects an incorrect signature", async () => {
  assertEquals(await verifySignature(BODY, "wrong-signature==", SECRET), false);
});

Deno.test("verifySignature rejects a missing signature", async () => {
  assertEquals(await verifySignature(BODY, null, SECRET), false);
});

import { pushMessage, resolveName } from "./line.ts";

function withMockedFetch(
  impl: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
  fn: () => Promise<void>,
) {
  const original = globalThis.fetch;
  globalThis.fetch = impl as typeof fetch;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

Deno.test("pushMessage posts to the LINE push endpoint with the bearer token", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;

  await withMockedFetch(
    (url, init) => {
      capturedUrl = url.toString();
      capturedInit = init;
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
    async () => {
      await pushMessage("token-123", "Uabc", "hello");
    },
  );

  assertEquals(capturedUrl, "https://api.line.me/v2/bot/message/push");
  assertEquals(
    (capturedInit?.headers as Record<string, string>)["Authorization"],
    "Bearer token-123",
  );
  assertEquals(
    JSON.parse(capturedInit?.body as string),
    { to: "Uabc", messages: [{ type: "text", text: "hello" }] },
  );
});

Deno.test("pushMessage throws on a non-ok response", async () => {
  await withMockedFetch(
    () => Promise.resolve(new Response("bad request", { status: 400 })),
    async () => {
      let threw = false;
      try {
        await pushMessage("token-123", "Uabc", "hello");
      } catch {
        threw = true;
      }
      assertEquals(threw, true);
    },
  );
});

Deno.test("resolveName fetches a user profile for a user id", async () => {
  await withMockedFetch(
    (url) => {
      assertEquals(url.toString(), "https://api.line.me/v2/bot/profile/Uabc");
      return Promise.resolve(
        new Response(JSON.stringify({ displayName: "Guy" }), { status: 200 }),
      );
    },
    async () => {
      const name = await resolveName("token-123", "Uabc");
      assertEquals(name, "Guy");
    },
  );
});

Deno.test("resolveName fetches a group summary for a group id", async () => {
  await withMockedFetch(
    (url) => {
      assertEquals(url.toString(), "https://api.line.me/v2/bot/group/Cabc/summary");
      return Promise.resolve(
        new Response(JSON.stringify({ groupName: "Family" }), { status: 200 }),
      );
    },
    async () => {
      const name = await resolveName("token-123", "Cabc");
      assertEquals(name, "Family");
    },
  );
});

Deno.test("resolveName returns null on a failed lookup", async () => {
  await withMockedFetch(
    () => Promise.resolve(new Response("not found", { status: 404 })),
    async () => {
      const name = await resolveName("token-123", "Uabc");
      assertEquals(name, null);
    },
  );
});
