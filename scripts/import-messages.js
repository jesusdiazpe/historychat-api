const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const RAW_DIR = path.join(__dirname, "../data/raw");
const DB_PATH = path.join(__dirname, "../data/chat.db");

const db = new Database(DB_PATH);

function fixEncoding(text) {
  if (!text || typeof text !== "string") return text;

  try {
    return Buffer.from(text, "latin1").toString("utf8");
  } catch {
    return text;
  }
}

function getMessageType(message) {
  if (message.content) return "text";
  if (message.photos?.length) return "photo";
  if (message.videos?.length) return "video";
  if (message.audio_files?.length) return "audio";
  if (message.sticker) return "sticker";
  return "unknown";
}

function getMediaUri(message) {
  if (message.photos?.length) return message.photos[0].uri || "";
  if (message.videos?.length) return message.videos[0].uri || "";
  if (message.audio_files?.length) return message.audio_files[0].uri || "";
  if (message.sticker?.uri) return message.sticker.uri;
  return "";
}

db.exec(`
  DROP TABLE IF EXISTS messages;
  DROP TABLE IF EXISTS messages_fts;

  CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_name TEXT,
    sender_name_fixed TEXT,
    timestamp_ms INTEGER,
    date TEXT,
    year INTEGER,
    content_original TEXT,
    content_fixed TEXT,
    type TEXT,
    media_uri TEXT,
    source_file TEXT
  );

  CREATE VIRTUAL TABLE messages_fts USING fts5(
    content_fixed,
    sender_name_fixed,
    content='messages',
    content_rowid='id'
  );
`);

const insert = db.prepare(`
  INSERT INTO messages (
    sender_name,
    sender_name_fixed,
    timestamp_ms,
    date,
    year,
    content_original,
    content_fixed,
    type,
    media_uri,
    source_file
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertFts = db.prepare(`
  INSERT INTO messages_fts(rowid, content_fixed, sender_name_fixed)
  VALUES (?, ?, ?)
`);

const files = fs
  .readdirSync(RAW_DIR)
  .filter(file => /^message_\d+\.json$/.test(file))
  .sort((a, b) => {
    const na = Number(a.match(/\d+/)[0]);
    const nb = Number(b.match(/\d+/)[0]);
    return na - nb;
  });

let total = 0;

const transaction = db.transaction(() => {
  for (const file of files) {
    const filePath = path.join(RAW_DIR, file);
    const json = JSON.parse(fs.readFileSync(filePath, "utf8"));

    for (const message of json.messages || []) {
      const timestamp = message.timestamp_ms || 0;
      const dateObj = new Date(timestamp);
      const date = dateObj.toISOString();
      const year = dateObj.getFullYear();

      const senderOriginal = message.sender_name || "";
      const senderFixed = fixEncoding(senderOriginal);

      const contentOriginal = message.content || "";
      const contentFixed = fixEncoding(contentOriginal);

      const type = getMessageType(message);
      const mediaUri = getMediaUri(message);

      const result = insert.run(
        senderOriginal,
        senderFixed,
        timestamp,
        date,
        year,
        contentOriginal,
        contentFixed,
        type,
        mediaUri,
        file
      );

      insertFts.run(result.lastInsertRowid, contentFixed, senderFixed);

      total++;
    }

    console.log(`Importado: ${file}`);
  }
});

transaction();

console.log(`Listo. Mensajes importados: ${total}`);
console.log(`BD creada en: ${DB_PATH}`);