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
