import express from "express";
import cors from "cors";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import axios from "axios";
import crypto from "crypto";
import fs from "fs";
import { nanoid } from "nanoid";

const PORT = process.env.PORT || 3001;
const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://ollama:11434";
const MODEL_NAME = process.env.OLLAMA_MODEL || "llama3.2";
const CACHE_TTL_MS = parseInt(process.env.CACHE_TTL_MS || "600000");

const DATA_DIR = process.env.DATA_DIR || "./data";
const SESSIONS_FILE = `${DATA_DIR}/sessions.json`;
const CACHE_FILE = `${DATA_DIR}/cache.json`;

fs.mkdirSync(DATA_DIR, { recursive: true });

if (!fs.existsSync(SESSIONS_FILE))
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify({ sessions: [] }, null, 2));

if (!fs.existsSync(CACHE_FILE))
  fs.writeFileSync(CACHE_FILE, JSON.stringify({ entries: {} }, null, 2));

const readSessions = () => JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8"));
const writeSessions = (obj) =>
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj, null, 2));

const readCache = () => JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
const writeCache = (obj) =>
  fs.writeFileSync(CACHE_FILE, JSON.stringify(obj, null, 2));

function appendTurn(sessionId, role, text) {
  const store = readSessions();
  const session = store.sessions.find((s) => s.id === sessionId);
  if (session) {
    session.turns.push({ role, text });
    writeSessions(store);
  }
}

function getSession(sessionId) {
  return readSessions().sessions.find((s) => s.id === sessionId) || null;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));

const getApiKey = (req) => req.header("x-api-key") || "anonymous";

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    keyGenerator: (req) => `${getApiKey(req)}::${req.ip}`,
    message: { error: "Rate limit exceeded" },
  })
);

app.get("/v1/health", async (req, res) => {
  try {
    const response = await axios.get(`${OLLAMA_HOST}/api/tags`, { timeout: 2000 });
    const modelNames = response.data.models.map((m) => m.name);

    const isLoaded = modelNames.some((m) => m.split(":")[0] === MODEL_NAME);

    return res.json({
      status: isLoaded ? "running" : "no_running",
      model: MODEL_NAME,
      availableModels: modelNames,
    });
  } catch (err) {
    return res.status(503).json({
      status: "offline",
      model: MODEL_NAME,
      availableModels: [],
    });
  }
});

app.get("/v1/sessions", (req, res) => {
  res.json(readSessions().sessions);
});

app.get("/v1/sessions/:id", (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: "not_found" });
  res.json(session);
});

app.post("/v1/sessions", (req, res) => {
  const store = readSessions();
  const id = nanoid();
  const title = req.body?.title || `Session ${new Date().toISOString()}`;
  store.sessions.push({ id, title, turns: [] });
  writeSessions(store);
  res.json({ id, title });
});

app.delete("/v1/sessions/:id", (req, res) => {
  const store = readSessions();
  writeSessions({
    sessions: store.sessions.filter((s) => s.id !== req.params.id),
  });
  res.json({ ok: true });
});

app.get("/v1/cache", (req, res) => {
  res.json({ keys: Object.keys(readCache().entries) });
});

app.delete("/v1/cache", (req, res) => {
  writeCache({ entries: {} });
  res.json({ ok: true });
});

const metrics = {
  requests: 0,
  tokensStreamed: 0,
  cacheHits: 0,
  cacheMisses: 0,
  errors: 0,
  startTs: Date.now(),
};

app.get("/v1/admin/metrics", (req, res) => {
  res.json(metrics);
});

const createCacheKey = (prompt, system, params) => {
  const h = crypto.createHash("sha256");
  h.update(JSON.stringify({ prompt, system, params }));
  return h.digest("hex");
};

app.post("/v1/chat/completions", async (req, res) => {
  metrics.requests++;

  try {
    const { prompt, params = {}, system = "", sessionId = null } = req.body;

    if (sessionId) appendTurn(sessionId, "user", prompt);

    const key = createCacheKey(prompt, system, params);
    const cache = readCache();
    const entry = cache.entries[key];
    const now = Date.now();

    if (entry && now - entry.createdAt < CACHE_TTL_MS) {
      metrics.cacheHits++;

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      for (const t of entry.tokens) {
        res.write(`event: token\ndata: ${JSON.stringify({ token: t })}\n\n`);
      }
      res.write(`event: done\ndata: {}\n\n`);
      return res.end();
    }

    metrics.cacheMisses++;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const ollamaReq = {
      model: MODEL_NAME,
      prompt: (system ? `System: ${system}\n\n` : "") + prompt,
      stream: true,
      options: {
        temperature: params.temperature ?? 0.7,
        top_p: params.top_p ?? 0.9,
        num_predict: params.max_tokens ?? 256,
      },
    };

    const stream = await axios({
      method: "POST",
      url: `${OLLAMA_HOST}/api/generate`,
      data: ollamaReq,
      responseType: "stream",
      timeout: 0,
    });

    const tokens = [];

    stream.data.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (!text) return;

      for (const line of text.split("\n")) {
        try {
          const obj = JSON.parse(line);

          if (obj.response) {
            const t = obj.response;
            tokens.push(t);
            metrics.tokensStreamed++;
            res.write(`event: token\ndata: ${JSON.stringify({ token: t })}\n\n`);
          }

          if (obj.done) {
            const fullResponse = tokens.join("");

            if (sessionId) {
              appendTurn(sessionId, "assistant", fullResponse);
            }

            cache.entries[key] = { tokens, createdAt: Date.now() };
            writeCache(cache);

            res.write(`event: done\ndata: {}\n\n`);
            res.end();
          }
        } catch (e) {
        }
      }
    });

    stream.data.on("error", () => {
      metrics.errors++;
      try {
        res.write(`event: error\ndata: {"message":"stream error"}\n\n`);
        res.end();
      } catch {}
    });
  } catch (err) {
    metrics.errors++;
    if (!res.headersSent) {
      res.status(500).json({ error: "backend_error", detail: String(err) });
    }
  }
});

app.listen(PORT, () => {
  console.log(`PocketLLM backend listening on :${PORT}`);
});
