const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'bot.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS recipients (
    userId    TEXT PRIMARY KEY,
    active    INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS message_log (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT NOT NULL,
    sentAt TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const queries = {
  getActiveRecipients: db.prepare('SELECT userId FROM recipients WHERE active = 1'),
  getAllRecipients: db.prepare('SELECT userId, createdAt FROM recipients WHERE active = 1'),
  upsertRecipient: db.prepare(`
    INSERT INTO recipients (userId, active) VALUES (?, 1)
    ON CONFLICT(userId) DO UPDATE SET active = 1
  `),
  deactivateRecipient: db.prepare('UPDATE recipients SET active = 0 WHERE userId = ?'),
  deleteRecipient: db.prepare('DELETE FROM recipients WHERE userId = ?'),
  activeCount: db.prepare('SELECT COUNT(*) as count FROM recipients WHERE active = 1'),
  logMessage: db.prepare('INSERT INTO message_log (userId) VALUES (?)'),
  monthlyCount: db.prepare(`
    SELECT COUNT(*) as count FROM message_log
    WHERE strftime('%Y-%m', sentAt) = ?
  `),
  getConfig: db.prepare('SELECT value FROM config WHERE key = ?'),
  setConfig: db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)'),
};

module.exports = { db, queries };
