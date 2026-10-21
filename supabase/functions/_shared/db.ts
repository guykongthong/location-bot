import { createClient } from "npm:@supabase/supabase-js@2";

export function createDb(supabaseUrl: string, serviceRoleKey: string) {
  const client = createClient(supabaseUrl, serviceRoleKey);

  return {
    async getActiveRecipients(): Promise<string[]> {
      const { data, error } = await client
        .from("recipients")
        .select("user_id")
        .eq("active", true);
      if (error) throw error;
      return data.map((r: { user_id: string }) => r.user_id);
    },

    async getAllRecipients(): Promise<{ user_id: string; created_at: string }[]> {
      const { data, error } = await client
        .from("recipients")
        .select("user_id, created_at")
        .eq("active", true);
      if (error) throw error;
      return data;
    },

    async upsertRecipient(userId: string): Promise<void> {
      const { error } = await client
        .from("recipients")
        .upsert({ user_id: userId, active: true });
      if (error) throw error;
    },

    async deactivateRecipient(userId: string): Promise<void> {
      const { error } = await client
        .from("recipients")
        .update({ active: false })
        .eq("user_id", userId);
      if (error) throw error;
    },

    async deleteRecipient(userId: string): Promise<number> {
      const { error, count } = await client
        .from("recipients")
        .delete({ count: "exact" })
        .eq("user_id", userId);
      if (error) throw error;
      return count ?? 0;
    },

    async activeCount(): Promise<number> {
      const { count, error } = await client
        .from("recipients")
        .select("*", { count: "exact", head: true })
        .eq("active", true);
      if (error) throw error;
      return count ?? 0;
    },

    async logMessage(userId: string): Promise<void> {
      const { error } = await client
        .from("message_log")
        .insert({ user_id: userId });
      if (error) throw error;
    },

    async monthlyCount(yearMonth: string): Promise<number> {
      const [y, m] = yearMonth.split("-").map(Number);
      const start = `${yearMonth}-01T00:00:00Z`;
      const end = m === 12
        ? `${y + 1}-01-01T00:00:00Z`
        : `${y}-${String(m + 1).padStart(2, "0")}-01T00:00:00Z`;

      const { count, error } = await client
        .from("message_log")
        .select("*", { count: "exact", head: true })
        .gte("sent_at", start)
        .lt("sent_at", end);
      if (error) throw error;
      return count ?? 0;
    },

    async getConfig(key: string): Promise<string | null> {
      const { data, error } = await client
        .from("config")
        .select("value")
        .eq("key", key)
        .maybeSingle();
      if (error) throw error;
      return data?.value ?? null;
    },

    async setConfig(key: string, value: string): Promise<void> {
      const { error } = await client.from("config").upsert({ key, value });
      if (error) throw error;
    },
  };
}
