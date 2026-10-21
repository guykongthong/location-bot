import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleArrived } from "./arrivedHandler.ts";

function fakeDeps(overrides: Partial<{
  config: Record<string, string>;
  recipients: string[];
  monthlyCount: number;
  now: number;
  pushFailFor: Set<string>;
}> = {}) {
  const config: Record<string, string> = { ...(overrides.config ?? {}) };
  const recipients = overrides.recipients ?? ["Uabc"];
  const monthlyCount = overrides.monthlyCount ?? 1;
  const now = overrides.now ?? 1_000_000;
  const pushFailFor = overrides.pushFailFor ?? new Set<string>();
  const logged: string[] = [];
  const pushed: string[] = [];

  return {
    deps: {
      db: {
        getConfig: (key: string) => Promise.resolve(config[key] ?? null),
        setConfig: (key: string, value: string) => {
          config[key] = value;
          return Promise.resolve();
        },
        getActiveRecipients: () => Promise.resolve(recipients),
        logMessage: (userId: string) => {
          logged.push(userId);
          return Promise.resolve();
        },
        monthlyCount: () => Promise.resolve(monthlyCount),
      },
      pushMessage: (_token: string, to: string, _text: string) => {
        pushed.push(to);
        if (pushFailFor.has(to)) return Promise.reject(new Error("push failed"));
        return Promise.resolve();
      },
      accessToken: "token-123",
      now: () => now,
    },
    logged,
    pushed,
    config,
  };
}

Deno.test("sends to all active recipients and logs each send", async () => {
  const { deps, logged, pushed } = fakeDeps({ recipients: ["Uabc", "Cxyz"] });

  const result = await handleArrived(deps, "hello", "last_trigger_home");

  assertEquals(result.status, 200);
  assertEquals(result.body, {
    sent: 2,
    failed: 0,
    details: { sent: ["Uabc", "Cxyz"], failed: [] },
  });
  assertEquals(logged, ["Uabc", "Cxyz"]);
  assertEquals(pushed, ["Uabc", "Cxyz"]);
});

Deno.test("returns 429 when cooldown is active", async () => {
  const { deps } = fakeDeps({
    config: { last_trigger_home: String(1_000_000 - 5 * 60 * 1000) }, // 5 min ago
    now: 1_000_000,
  });

  const result = await handleArrived(deps, "hello", "last_trigger_home");

  assertEquals(result.status, 429);
  assertEquals((result.body as { error: string }).error, "Cooldown active");
  assertEquals((result.body as { remainingMinutes: number }).remainingMinutes, 25);
});

Deno.test("allows trigger once cooldown has elapsed", async () => {
  const { deps } = fakeDeps({
    config: { last_trigger_home: String(1_000_000 - 31 * 60 * 1000) }, // 31 min ago
    now: 1_000_000,
  });

  const result = await handleArrived(deps, "hello", "last_trigger_home");

  assertEquals(result.status, 200);
});

Deno.test("records failed pushes separately from successful ones", async () => {
  const { deps } = fakeDeps({
    recipients: ["Uabc", "Ubad"],
    pushFailFor: new Set(["Ubad"]),
  });

  const result = await handleArrived(deps, "hello", "last_trigger_home");

  assertEquals(result.body, {
    sent: 1,
    failed: 1,
    details: {
      sent: ["Uabc"],
      failed: [{ userId: "Ubad", error: "push failed" }],
    },
  });
});

Deno.test("returns sent:0 immediately when there are no active recipients", async () => {
  const { deps, pushed } = fakeDeps({ recipients: [] });

  const result = await handleArrived(deps, "hello", "last_trigger_home");

  assertEquals(result.body, { sent: 0, failed: 0, details: { sent: [], failed: [] } });
  assertEquals(pushed, []);
});
