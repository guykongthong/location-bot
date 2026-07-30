require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env before running this script.');
  process.exit(1);
}

const db = new Database(path.join(__dirname, '..', 'data', 'bot.db'), { readonly: true });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function migrate() {
  const recipients = db.prepare('SELECT userId, active, createdAt FROM recipients').all();
  const messageLog = db.prepare('SELECT userId, sentAt FROM message_log').all();
  const config = db.prepare('SELECT key, value FROM config').all();

  if (recipients.length > 0) {
    const { error } = await supabase.from('recipients').upsert(
      recipients.map((r) => ({ user_id: r.userId, active: !!r.active, created_at: r.createdAt }))
    );
    if (error) throw error;
    console.log(`Migrated ${recipients.length} recipients`);
  }

  if (messageLog.length > 0) {
    const { error } = await supabase.from('message_log').insert(
      messageLog.map((m) => ({ user_id: m.userId, sent_at: m.sentAt }))
    );
    if (error) throw error;
    console.log(`Migrated ${messageLog.length} message_log rows`);
  }

  if (config.length > 0) {
    const { error } = await supabase.from('config').upsert(config);
    if (error) throw error;
    console.log(`Migrated ${config.length} config rows`);
  }

  console.log('Migration complete.');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
