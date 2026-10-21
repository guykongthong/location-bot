export interface ArrivedDb {
  getConfig(key: string): Promise<string | null>;
  setConfig(key: string, value: string): Promise<void>;
  getActiveRecipients(): Promise<string[]>;
  logMessage(userId: string): Promise<void>;
  monthlyCount(yearMonth: string): Promise<number>;
}

export interface ArrivedDeps {
  db: ArrivedDb;
  pushMessage: (accessToken: string, to: string, text: string) => Promise<void>;
  accessToken: string;
  now: () => number;
}

const COOLDOWN_MS = 30 * 60 * 1000;
const MONTHLY_WARN_THRESHOLD = 400;

export async function handleArrived(
  deps: ArrivedDeps,
  text: string,
  cooldownKey: string,
): Promise<{ status: number; body: unknown }> {
  const lastTrigger = await deps.db.getConfig(cooldownKey);
  if (lastTrigger) {
    const elapsed = deps.now() - parseInt(lastTrigger, 10);
    if (elapsed < COOLDOWN_MS) {
      const remainingMinutes = Math.ceil((COOLDOWN_MS - elapsed) / 60000);
      return { status: 429, body: { error: "Cooldown active", remainingMinutes } };
    }
  }

  await deps.db.setConfig(cooldownKey, String(deps.now()));

  const recipients = await deps.db.getActiveRecipients();
  if (recipients.length === 0) {
    return { status: 200, body: { sent: 0, failed: 0, details: { sent: [], failed: [] } } };
  }

  const results = {
    sent: [] as string[],
    failed: [] as { userId: string; error: string }[],
  };

  for (const userId of recipients) {
    try {
      await deps.pushMessage(deps.accessToken, userId, text);
      await deps.db.logMessage(userId);
      results.sent.push(userId);
    } catch (err) {
      results.failed.push({
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const now = new Date(deps.now());
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthlyCount = await deps.db.monthlyCount(yearMonth);
  if (monthlyCount >= MONTHLY_WARN_THRESHOLD) {
    console.warn(
      `Warning: Monthly push count is ${monthlyCount} — approaching LINE free tier limit (500/month)`,
    );
  }

  return {
    status: 200,
    body: { sent: results.sent.length, failed: results.failed.length, details: results },
  };
}
