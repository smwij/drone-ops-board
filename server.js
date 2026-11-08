// Drone Ops Board — standalone server.
// Provides the same primitives the claude.ai Artifact runtime gave the page:
// a JSON document store, a file store, and optional certificate OCR via the
// Anthropic API. Auth is two shared access codes: CREW_CODE (read/write) and
// ADMIN_CODE (also manager approval). Data lives in DATA_DIR as plain files.
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA = process.env.DATA_DIR || path.join(__dirname, "data");
const UPLOADS = path.join(DATA, "uploads");
fs.mkdirSync(UPLOADS, { recursive: true });
const DB_FILE = path.join(DATA, "db.json");

let db = { collections: {}, files: {} };
try { db = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch (e) {}
db.collections = db.collections || {};
db.files = db.files || {};

// Seed sample data on an empty database (first boot, or after a free-tier reset).
if (!Object.keys(db.collections).length) {
  try {
    const seed = JSON.parse(fs.readFileSync(path.join(__dirname, "seed.json"), "utf8"));
    db.collections = seed.collections || {};
    for (const [id, f] of Object.entries(seed.files || {})) {
      fs.writeFileSync(path.join(UPLOADS, id), Buffer.from(f.content, "utf8"));
      db.files[id] = { name: f.name, ct: f.ct, size: Buffer.byteLength(f.content, "utf8") };
    }
    console.log("Seeded sample data (database was empty).");
  } catch (e) { /* no seed file — start empty */ }
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFileSync(DB_FILE + ".tmp", JSON.stringify(db));
    fs.renameSync(DB_FILE + ".tmp", DB_FILE);
  }, 300);
}

const CREW = process.env.CREW_CODE || "crew";
const ADMIN = process.env.ADMIN_CODE || "admin";
if (!process.env.CREW_CODE) console.warn("WARNING: CREW_CODE not set — using default 'crew'. Set real codes in production.");

function role(req) {
  let code = req.get("x-access-code");
  if (!code) {
    const m = String(req.headers.cookie || "").match(/(?:^|;\s*)ops=([^;]*)/);
    if (m) code = decodeURIComponent(m[1]);
  }
  return code === ADMIN ? "admin" : code === CREW ? "crew" : null;
}
function need(req, res) {
  const r = role(req);
  if (!r) res.status(401).json({ error: "sign in" });
  return r;
}
function okPath(p, even) {
  const seg = String(p).split("/");
  if (seg.some(x => !/^[A-Za-z0-9_\-.~:@+]{1,200}$/.test(x))) return false;
  return even ? seg.length % 2 === 0 : seg.length % 2 === 1;
}

const app = express();
app.use(express.json({ limit: "4mb" }));

app.get("/api/config", (req, res) => res.json({ ocr: !!process.env.ANTHROPIC_API_KEY }));
app.get("/api/me", (req, res) => res.json({ role: role(req) }));
app.post("/api/login", (req, res) => {
  const code = req.body && req.body.code;
  const r = code === ADMIN ? "admin" : code === CREW ? "crew" : null;
  if (!r) return res.status(401).json({ error: "bad code" });
  res.json({ role: r });
});

app.get("/api/col/*", (req, res) => {
  if (!need(req, res)) return;
  const p = req.params[0];
  if (!okPath(p, false)) return res.status(400).json({ error: "bad path" });
  const col = db.collections[p] || {};
  res.json({ docs: Object.entries(col).map(([id, data]) => ({ id, data })) });
});
app.post("/api/col/*", (req, res) => {
  if (!need(req, res)) return;
  const p = req.params[0];
  if (!okPath(p, false)) return res.status(400).json({ error: "bad path" });
  const id = crypto.randomUUID();
  (db.collections[p] = db.collections[p] || {})[id] = req.body || {};
  save();
  res.json({ id });
});
function splitDoc(p) {
  const i = p.lastIndexOf("/");
  return [p.slice(0, i), p.slice(i + 1)];
}
app.put("/api/doc/*", (req, res) => {
  if (!need(req, res)) return;
  const p = req.params[0];
  if (!okPath(p, true)) return res.status(400).json({ error: "bad path" });
  const [col, id] = splitDoc(p);
  (db.collections[col] = db.collections[col] || {})[id] = req.body || {};
  save();
  res.json({ ok: true });
});
app.patch("/api/doc/*", (req, res) => {
  if (!need(req, res)) return;
  const p = req.params[0];
  if (!okPath(p, true)) return res.status(400).json({ error: "bad path" });
  const [col, id] = splitDoc(p);
  const c = db.collections[col];
  if (!c || !c[id]) return res.status(404).json({ error: "not found" });
  Object.assign(c[id], req.body || {});
  save();
  res.json({ ok: true });
});
app.delete("/api/doc/*", (req, res) => {
  if (!need(req, res)) return;
  const p = req.params[0];
  if (!okPath(p, true)) return res.status(400).json({ error: "bad path" });
  const [col, id] = splitDoc(p);
  if (db.collections[col]) delete db.collections[col][id];
  save();
  res.json({ ok: true });
});

app.post("/api/upload", express.raw({ type: "*/*", limit: "25mb" }), (req, res) => {
  if (!need(req, res)) return;
  if (!req.body || !req.body.length) return res.status(400).json({ error: "empty file" });
  const id = crypto.randomBytes(16).toString("hex");
  const name = decodeURIComponent(req.get("x-file-name") || "file");
  const ct = req.get("content-type") || "application/octet-stream";
  fs.writeFileSync(path.join(UPLOADS, id), req.body);
  db.files[id] = { name, ct, size: req.body.length };
  save();
  res.json({ id, url: "/_blob/" + id, contentType: ct, sizeBytes: req.body.length });
});
app.delete("/api/blob/:id", (req, res) => {
  if (!need(req, res)) return;
  const id = req.params.id;
  if (!/^[0-9a-f]{32}$/.test(id)) return res.status(400).json({ error: "bad id" });
  delete db.files[id];
  try { fs.unlinkSync(path.join(UPLOADS, id)); } catch (e) {}
  save();
  res.json({ ok: true });
});
app.get("/_blob/:id", (req, res) => {
  if (!need(req, res)) return;
  const id = req.params.id;
  const meta = db.files[id];
  if (!meta || !/^[0-9a-f]{32}$/.test(id)) return res.status(404).end();
  res.setHeader("content-type", meta.ct);
  res.setHeader("content-disposition", "inline; filename*=UTF-8''" + encodeURIComponent(meta.name));
  res.sendFile(path.join(UPLOADS, id));
});

// Certificate OCR: forwards one image + prompt to the Anthropic API.
app.post("/api/ocr", async (req, res) => {
  if (!need(req, res)) return;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(400).json({ error: "OCR not configured" });
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5",
        max_tokens: 500,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: req.body.media_type || "image/jpeg", data: req.body.data } },
          { type: "text", text: String(req.body.prompt || "") }
        ]}]
      })
    });
    const j = await r.json();
    if (!r.ok) return res.status(502).json({ error: (j.error && j.error.message) || "upstream error" });
    const text = (j.content || []).map(c => c.text || "").join("");
    const a = text.indexOf("{"), b = text.lastIndexOf("}");
    let parsed = null;
    if (a >= 0 && b > a) { try { parsed = JSON.parse(text.slice(a, b + 1)); } catch (e) {} }
    res.json({ json: parsed });
  } catch (e) {
    res.status(502).json({ error: String(e && e.message || e) });
  }
});

app.use(express.static(path.join(__dirname, "public")));

const WRAP = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;font-family:system-ui;font-size:14px}[hidden]{display:none!important}img{max-width:100%}</style>
<script src="/shim.js"></script>
`;
app.get("/", (req, res) => {
  const page = fs.readFileSync(path.join(__dirname, "fleet-asset-register.html"), "utf8");
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.send(WRAP + page);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Drone ops board listening on :" + PORT + " (data in " + DATA + ")"));
