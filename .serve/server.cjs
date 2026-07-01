// Minimal zero-dependency shared-state server for ProjectPlan.html (SiteAgent / Instatic fleet).
// Serves the page and holds ONE shared copy of task status/notes for all viewers.
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 8091;
const HOST = "127.0.0.1";
const DIR = __dirname;
const STATE_FILE = path.join(DIR, "state.json");
const PAGE_FILE = path.join(DIR, "ProjectPlan.html");
const CHANGELOG_FILE = path.join(DIR, "..", "docs", "CHANGELOG.md");
const STATUSES = new Set(["todo", "in_progress", "done", "blocked"]);

let store = { rev: 0, tasks: {} };
try {
  if (fs.existsSync(STATE_FILE)) {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (parsed && typeof parsed === "object" && parsed.tasks && typeof parsed.tasks === "object") {
      store.tasks = parsed.tasks;
      store.rev = typeof parsed.rev === "number" ? parsed.rev : 0;
    }
  }
} catch (e) { console.error("Could not load state.json:", e.message); }

let writeTimer = null;
function persist() {
  store.rev++;
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(store)); }
    catch (e) { console.error("Write failed:", e.message); }
  }, 150);
}

function cleanTask(v) {
  v = v || {};
  return {
    status: STATUSES.has(v.status) ? v.status : "todo",
    notes: typeof v.notes === "string" ? v.notes.slice(0, 5000) : ""
  };
}

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => { data += c; if (data.length > 2_000_000) req.destroy(); });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = (req.url || "/").split("?")[0];

  if (url === "/api/state" && req.method === "GET") {
    return sendJSON(res, 200, { rev: store.rev, tasks: store.tasks });
  }
  if (url === "/api/task" && req.method === "POST") {
    try {
      const body = JSON.parse(await readBody(req));
      if (!body || typeof body.id !== "string") return sendJSON(res, 400, { error: "bad id" });
      store.tasks[body.id] = cleanTask(body);
      persist();
      return sendJSON(res, 200, { rev: store.rev });
    } catch (e) { return sendJSON(res, 400, { error: "bad json" }); }
  }
  if (url === "/api/bulk" && req.method === "POST") {
    try {
      const body = JSON.parse(await readBody(req));
      const incoming = (body && body.tasks && typeof body.tasks === "object") ? body.tasks : {};
      const clean = {};
      for (const id in incoming) clean[id] = cleanTask(incoming[id]);
      store.tasks = body && body.replace ? clean : Object.assign({}, store.tasks, clean);
      persist();
      return sendJSON(res, 200, { rev: store.rev });
    } catch (e) { return sendJSON(res, 400, { error: "bad json" }); }
  }
  if (url === "/api/changelog" && req.method === "GET") {
    return fs.readFile(CHANGELOG_FILE, "utf8", (err, text) => {
      if (err) return sendJSON(res, 404, { error: "no changelog" });
      res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-store" });
      res.end(text);
    });
  }
  if (url === "/" || url === "/ProjectPlan.html") {
    return fs.readFile(PAGE_FILE, (err, buf) => {
      if (err) { res.writeHead(404); return res.end("not found"); }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(buf);
    });
  }
  res.writeHead(404); res.end("not found");
});

server.listen(PORT, HOST, () => console.log(`SiteAgent ProjectPlan server on http://${HOST}:${PORT}  (rev ${store.rev})`));
