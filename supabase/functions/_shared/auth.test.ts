import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkSecret } from "./auth.ts";

Deno.test("checkSecret returns true when header matches", () => {
  const req = new Request("https://example.com", {
    headers: { "x-secret": "correct-secret" },
  });
  assertEquals(checkSecret(req, "correct-secret"), true);
});

Deno.test("checkSecret returns false when header does not match", () => {
  const req = new Request("https://example.com", {
    headers: { "x-secret": "wrong-secret" },
  });
  assertEquals(checkSecret(req, "correct-secret"), false);
});

Deno.test("checkSecret returns false when header is missing", () => {
  const req = new Request("https://example.com");
  assertEquals(checkSecret(req, "correct-secret"), false);
});
