require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const Database = require("better-sqlite3");

const app = express();
const PORT = process.env.PORT || 3000;

const db = new Database(path.join(__dirname, "../data/chat.db"));

app.use(cors());
app.use(express.json());

app.post("/api/tts", async (req, res) => {
  try {
    const { text, speaker } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({
        error: "Texto vacío"
      });
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;

    const voiceId =
      speaker === "male"
        ? process.env.ELEVENLABS_MALE_VOICE_ID
        : process.env.ELEVENLABS_TANYA_VOICE_ID;

    if (!apiKey || !voiceId) {
      return res.status(500).json({
        error: "Faltan variables ElevenLabs"
      });
    }

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg"
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.4,
            similarity_boost: 0.85,
            style: 0.45,
            use_speaker_boost: true
          }
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();

      console.error(errorText);

      return res.status(response.status).json({
        error: errorText
      });
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());

    res.setHeader("Content-Type", "audio/mpeg");
    res.send(audioBuffer);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: error.message
    });
  }
});

app.get("/api/search", (req, res) => {
  const q = String(req.query.q || "").trim();
  const offset = Number(req.query.offset || 0);
  const limit = Number(req.query.limit || 50);

  if (!q) {
    return res.json([]);
  }

  const rows = db.prepare(`
    SELECT 
      m.id,
      m.sender_name_fixed AS sender_name,
      m.date,
      m.year,
      m.content_fixed AS content,
      m.type,
      m.media_uri,
      m.source_file
    FROM messages_fts fts
    JOIN messages m ON m.id = fts.rowid
    WHERE messages_fts MATCH ?
    ORDER BY m.timestamp_ms ASC
    LIMIT ?
    OFFSET ?
  `).all(q, limit, offset);

  res.json(rows);
});

app.get("/api/messages", (req, res) => {
  const year = req.query.year;

  let rows;

  if (year) {
    rows = db.prepare(`
      SELECT 
        id,
        sender_name_fixed AS sender_name,
        date,
        year,
        content_fixed AS content,
        type,
        media_uri
      FROM messages
      WHERE year = ?
      ORDER BY timestamp_ms ASC
      LIMIT 500
    `).all(year);
  } else {
    rows = db.prepare(`
      SELECT 
        id,
        sender_name_fixed AS sender_name,
        date,
        year,
        content_fixed AS content,
        type,
        media_uri
      FROM messages
      ORDER BY timestamp_ms ASC
      LIMIT 500
    `).all();
  }

  res.json(rows);
});

app.get("/api/context/:id", (req, res) => {
  const id = Number(req.params.id);

  const message = db.prepare(`
    SELECT timestamp_ms FROM messages WHERE id = ?
  `).get(id);

  if (!message) {
    return res.status(404).json({ error: "Mensaje no encontrado" });
  }

  const rows = db.prepare(`
    SELECT 
      id,
      sender_name_fixed AS sender_name,
      date,
      content_fixed AS content,
      type,
      media_uri
    FROM messages
    WHERE timestamp_ms BETWEEN ? AND ?
    ORDER BY timestamp_ms ASC
  `).all(
    message.timestamp_ms - 1000 * 60 * 30,
    message.timestamp_ms + 1000 * 60 * 30
  );

  res.json(rows);
});

app.get("/api/stats", (req, res) => {
  const total = db.prepare(`SELECT COUNT(*) AS total FROM messages`).get();
  const years = db.prepare(`
    SELECT year, COUNT(*) AS total
    FROM messages
    GROUP BY year
    ORDER BY year ASC
  `).all();

  const types = db.prepare(`
    SELECT type, COUNT(*) AS total
    FROM messages
    GROUP BY type
    ORDER BY total DESC
  `).all();

  res.json({
    totalMessages: total.total,
    years,
    types
  });
});

app.listen(PORT, () => {
  console.log(`API lista en http://localhost:${PORT}`);
});