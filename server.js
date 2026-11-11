/**
 * EDM checker web app.
 * Drop a Sesimi EDM template zip on the page: it is rendered to email HTML
 * and sent to Mailgun Email Preview, and the page shows progress and a link
 * to the results in Mailgun.
 *
 * Environment:
 *   MAILGUN_API_KEY   required. Kept on the server, never sent to the browser.
 *   MAILGUN_REGION    "us" (default) or "eu"
 *   APP_PASSWORD      optional. If set, the site asks for this password (any username).
 *   PORT              default 3000
 *   DATA_DIR          where shared client lists are saved. Default ./data
 *   PREVIEW_CLIENTS   optional. Comma-separated client IDs used to create the first
 *                     client list when none exist yet (named PREVIEW_CLIENTS_NAME).
 */
const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const AdmZip = require("adm-zip");

const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.MAILGUN_API_KEY;
const REGION = (process.env.MAILGUN_REGION || "us").toLowerCase();
const APP_PASSWORD = process.env.APP_PASSWORD || "";
// Only used to create the first shared client list when none exist yet.
const PREVIEW_CLIENTS = (process.env.PREVIEW_CLIENTS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const PREVIEW_CLIENTS_NAME = (process.env.PREVIEW_CLIENTS_NAME || "Default").trim().slice(0, 60);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const LISTS_FILE = path.join(DATA_DIR, "client-lists.json");
const MAILGUN_BASE =
  process.env.MAILGUN_BASE_URL || // for local testing against a mock only
  (REGION === "eu" ? "https://api.eu.mailgun.net" : "https://api.mailgun.net");

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_JSON_BYTES = 64 * 1024;
const MAX_LISTS = 50;
const CLIENTS_CACHE_MS = 60 * 60 * 1000;
const MAX_UNZIPPED_BYTES = 50 * 1024 * 1024;
const RENDER_TIMEOUT_MS = 30_000;
const JOB_TTL_MS = 60 * 60 * 1000;

if (!API_KEY) {
  console.error("MAILGUN_API_KEY is not set. Set it as an environment variable before starting.");
  process.exit(1);
}
if (!["us", "eu"].includes(REGION)) {
  console.error(`MAILGUN_REGION must be "us" or "eu", got "${REGION}".`);
  process.exit(1);
}

// testId -> { html, subject, fileName, createdAt, shareUrl }
const jobs = new Map();
setInterval(() => {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) if (job.createdAt < cutoff) jobs.delete(id);
}, 10 * 60 * 1000).unref();

// ---------- Mailgun ----------

async function mailgun(method, urlPath, body) {
  const res = await fetch(MAILGUN_BASE + urlPath, {
    method,
    headers: {
      Authorization: "Basic " + Buffer.from(`api:${API_KEY}`).toString("base64"),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    const hint =
      res.status === 401 || res.status === 403
        ? " Check the API key, the region, and that your Mailgun plan includes Email Preview."
        : "";
    throw new Error(`Mailgun returned ${res.status} for ${method} ${urlPath}.${hint} ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : {};
}

async function createPreviewTest(html, subject, clients) {
  const result = await mailgun("POST", "/v2/preview/tests", {
    subject,
    html,
    ...(clients && clients.length ? { clients } : {}),
    content_checking: {
      link_validation: true,
      image_validation: true,
      accessibility: true,
      code_analysis: true,
    },
  });
  return { testId: result.id, warnings: result.warnings || [] };
}

// ASSUMPTION: each client result has a "status" that reads "Complete" when done
// (the Email on Acid format Mailgun inherited).
const DONE = new Set(["complete", "completed", "bounced", "failed"]);
const FAILED = new Set(["bounced", "failed"]);

async function getProgress(testId) {
  const results = await mailgun("GET", `/v1/preview/tests/${encodeURIComponent(testId)}/results`);
  const entries = Object.entries(results).filter(([, v]) => v && typeof v === "object");
  const status = ([, v]) => String(v.status || "").toLowerCase();
  return {
    total: entries.length,
    done: entries.filter((e) => DONE.has(status(e))).length,
    failed: entries.filter((e) => FAILED.has(status(e))).map(([k, v]) => v.display_name || k),
  };
}

async function getShareUrl(testId) {
  // POST turns sharing on (it only returns "record created"); GET returns the public url.
  const share = () => mailgun("GET", `/v1/preview/sharing/${encodeURIComponent(testId)}`);
  try {
    const existing = await share();
    if (existing.url) return existing.url;
  } catch {
    // No share record yet; create one below.
  }
  await mailgun("POST", "/v1/preview/sharing", { test_id: testId });
  const result = await share();
  return result.url || null;
}

// All email clients Mailgun can test on, cached for an hour.
let clientsCache = { at: 0, list: [] };
async function getAllClients() {
  if (Date.now() - clientsCache.at < CLIENTS_CACHE_MS && clientsCache.list.length) return clientsCache.list;
  const result = await mailgun("GET", "/v1/preview/tests/clients");
  const raw = result.clients || {};
  const list = Object.values(raw)
    .filter((c) => c && c.id)
    .map((c) => ({ id: String(c.id), client: String(c.client || c.id), os: String(c.os || ""), category: String(c.category || "Other") }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.client.localeCompare(b.client) || a.os.localeCompare(b.os));
  clientsCache = { at: Date.now(), list };
  return list;
}

// ---------- Shared client lists (saved to DATA_DIR/client-lists.json) ----------

let lists = [];
let saving = Promise.resolve();

function loadLists() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(LISTS_FILE)) {
    lists = JSON.parse(fs.readFileSync(LISTS_FILE, "utf8"));
    return;
  }
  lists = PREVIEW_CLIENTS.length
    ? [{ id: crypto.randomUUID(), name: PREVIEW_CLIENTS_NAME, clients: PREVIEW_CLIENTS }]
    : [];
  fs.writeFileSync(LISTS_FILE, JSON.stringify(lists, null, 2));
}

function saveLists() {
  // Write to a temp file then rename, one save at a time, so the file is never half-written.
  const data = JSON.stringify(lists, null, 2);
  saving = saving.then(async () => {
    const tmp = `${LISTS_FILE}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, data);
    await fsp.rename(tmp, LISTS_FILE);
  });
  return saving;
}

async function validateList(body, ignoreId) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 60) throw new Error("Give the list a name (up to 60 characters).");
  const clash = lists.find((l) => l.id !== ignoreId && l.name.toLowerCase() === name.toLowerCase());
  if (clash) throw new Error(`There's already a list called "${clash.name}".`);
  if (!Array.isArray(body.clients) || body.clients.length === 0) throw new Error("Pick at least one email client.");
  const known = new Set((await getAllClients()).map((c) => c.id));
  const clients = [...new Set(body.clients.map(String))];
  const unknown = clients.filter((id) => !known.has(id));
  if (unknown.length) throw new Error(`Mailgun doesn't recognise these clients: ${unknown.slice(0, 5).join(", ")}`);
  return { name, clients };
}

// ---------- Rendering ----------

async function unzipSafely(buffer, destDir) {
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new Error("That file isn't a valid zip.");
  }
  const root = path.resolve(destDir);
  let total = 0;
  for (const entry of zip.getEntries()) {
    const target = path.resolve(root, entry.entryName);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`The zip contains an unsafe path (${entry.entryName}).`);
    }
    total += entry.header.size;
    if (total > MAX_UNZIPPED_BYTES) throw new Error("The zip is too large once unpacked.");
  }
  zip.extractAllTo(root, true);
}

function renderTemplate(dir) {
  // Use real paths: on macOS the temp folder (/var/...) is a symlink to /private/var/...,
  // and require() opens the real path, which the permission allow-list must match.
  // Only the template, the worker script and node_modules are readable — not the whole app
  // folder, which can hold .env (the API key) and the saved client lists.
  const templateDir = fs.realpathSync(dir);
  const worker = fs.realpathSync(path.join(__dirname, "render_worker.js"));
  const modules = fs.realpathSync(path.join(__dirname, "node_modules"));
  const args = [
    "--permission",
    `--allow-fs-read=${templateDir}`,
    `--allow-fs-read=${worker}`,
    `--allow-fs-read=${modules}`,
    worker,
    templateDir,
  ];
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      args,
      {
        timeout: RENDER_TIMEOUT_MS,
        maxBuffer: 20 * 1024 * 1024,
        env: { NODE_PATH: modules, PATH: process.env.PATH },
      },
      (err, stdout, stderr) => {
        let parsed = null;
        try {
          parsed = JSON.parse(stdout);
        } catch {}
        if (parsed && parsed.error) return reject(new Error(parsed.error));
        if (err) {
          if (err.killed) return reject(new Error("Rendering took too long and was stopped."));
          console.error("Render failed:", stderr);
          return reject(new Error("The template couldn't be rendered. See the server log for details."));
        }
        if (!parsed || !Array.isArray(parsed.pages)) return reject(new Error("The renderer returned no pages."));
        resolve(parsed.pages);
      }
    );
  });
}

// ---------- HTTP ----------

function send(res, status, body, type = "application/json") {
  const data = type === "application/json" ? JSON.stringify(body) : body;
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(data);
}

function authorized(req) {
  if (!APP_PASSWORD) return true;
  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) return false;
  const supplied = Buffer.from(header.slice(6), "base64").toString().split(":").slice(1).join(":");
  const a = Buffer.from(supplied);
  const b = Buffer.from(APP_PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Blocks cross-site requests (CSRF): a page on another site can make a logged-in visitor's
// browser send a POST, but only as a "simple" request (form-style content type) and with
// that other site's Origin. Requests that change things must come from this site and use
// the content type the page itself sends, which other sites can't without our permission.
function sameSiteError(req, url) {
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") return "Requests from other websites aren't allowed.";
  const origin = req.headers.origin;
  if (origin) {
    let host = "";
    try {
      host = new URL(origin).host;
    } catch {}
    const allowed = [req.headers.host, req.headers["x-forwarded-host"]].filter(Boolean);
    if (!allowed.includes(host)) return "Requests from other websites aren't allowed.";
  }
  const type = (req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (url.pathname === "/api/checks" && type !== "application/zip") return "Upload the zip from the page.";
  if (url.pathname.startsWith("/api/lists") && req.method !== "DELETE" && type !== "application/json") {
    return "Send list changes as JSON from the page.";
  }
  return null;
}

function readBody(req, limit = MAX_UPLOAD_BYTES, tooBig = "The zip is larger than 20 MB.") {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error(tooBig));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const body = await readBody(req, MAX_JSON_BYTES, "That request is too large.");
  try {
    return JSON.parse(body.toString("utf8") || "{}");
  } catch {
    throw new Error("That request isn't valid JSON.");
  }
}

async function handleCheck(req, res, url) {
  const fileName = (url.searchParams.get("name") || "template.zip").slice(0, 200);
  const subject = (url.searchParams.get("subject") || "").trim() || fileName.replace(/\.zip$/i, "");
  const listId = url.searchParams.get("list") || "";
  const list = listId ? lists.find((l) => l.id === listId) : null;
  if (listId && !list) return send(res, 400, { error: "That client list no longer exists. Pick another one." });

  const body = await readBody(req);
  if (body.length === 0) return send(res, 400, { error: "No file was received." });

  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "edm-"));
  try {
    await unzipSafely(body, tmp);
    const pages = await renderTemplate(tmp);

    const checks = [];
    for (const page of pages) {
      const pageSubject = pages.length > 1 ? `${subject} (page ${page.id})` : subject;
      const { testId, warnings } = await createPreviewTest(page.html, pageSubject, list && list.clients);
      jobs.set(testId, { html: page.html, subject: pageSubject, fileName, createdAt: Date.now(), shareUrl: null });
      const on = list ? `"${list.name}" (${list.clients.length} clients)` : "Mailgun default clients";
      console.log(`[${new Date().toISOString()}] ${fileName} page ${page.id} on ${on} -> Mailgun test ${testId}`);
      checks.push({ page: page.id, testId, subject: pageSubject, warnings, previewUrl: `/rendered/${testId}` });
    }
    send(res, 200, { checks });
  } finally {
    fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

async function handleStatus(res, testId) {
  const job = jobs.get(testId);
  if (!job) return send(res, 404, { error: "This check has expired or doesn't exist. Upload the zip again." });
  const progress = await getProgress(testId);
  const complete = progress.total > 0 && progress.done === progress.total;
  if (complete && !job.shareUrl) {
    try {
      job.shareUrl = await getShareUrl(testId);
    } catch (err) {
      console.error("Share link failed:", err.message);
      job.shareUrl = "";
    }
  }
  send(res, 200, { ...progress, complete, shareUrl: job.shareUrl || null });
}

const server = http.createServer(async (req, res) => {
  try {
    if (!authorized(req)) {
      res.writeHead(401, { "WWW-Authenticate": 'Basic realm="EDM checker"' });
      return res.end("Password required.");
    }
    const url = new URL(req.url, "http://localhost");
    if (req.method !== "GET" && req.method !== "HEAD") {
      const blocked = sameSiteError(req, url);
      if (blocked) {
        console.warn(`[${new Date().toISOString()}] Blocked ${req.method} ${url.pathname}: ${blocked} (origin: ${req.headers.origin || "none"})`);
        return send(res, 403, { error: blocked });
      }
    }

    if (req.method === "GET" && url.pathname === "/") {
      return send(res, 200, fs.readFileSync(path.join(__dirname, "public", "index.html")), "text/html; charset=utf-8");
    }
    if (req.method === "POST" && url.pathname === "/api/checks") {
      return await handleCheck(req, res, url);
    }
    const status = url.pathname.match(/^\/api\/checks\/([\w-]+)$/);
    if (req.method === "GET" && status) return await handleStatus(res, status[1]);

    if (req.method === "GET" && url.pathname === "/api/clients") {
      return send(res, 200, { clients: await getAllClients() });
    }
    if (url.pathname === "/api/lists") {
      if (req.method === "GET") return send(res, 200, { lists });
      if (req.method === "POST") {
        if (lists.length >= MAX_LISTS) return send(res, 400, { error: `There are already ${MAX_LISTS} lists. Delete one first.` });
        const fields = await validateList(await readJson(req));
        const list = { id: crypto.randomUUID(), ...fields };
        lists.push(list);
        await saveLists();
        console.log(`[${new Date().toISOString()}] Client list created: "${list.name}" (${list.clients.length})`);
        return send(res, 201, { list });
      }
    }
    const listMatch = url.pathname.match(/^\/api\/lists\/([\w-]+)$/);
    if (listMatch) {
      const index = lists.findIndex((l) => l.id === listMatch[1]);
      if (index === -1) return send(res, 404, { error: "That client list no longer exists." });
      if (req.method === "PUT") {
        const fields = await validateList(await readJson(req), lists[index].id);
        lists[index] = { ...lists[index], ...fields };
        await saveLists();
        console.log(`[${new Date().toISOString()}] Client list updated: "${lists[index].name}" (${lists[index].clients.length})`);
        return send(res, 200, { list: lists[index] });
      }
      if (req.method === "DELETE") {
        const [removed] = lists.splice(index, 1);
        await saveLists();
        console.log(`[${new Date().toISOString()}] Client list deleted: "${removed.name}"`);
        return send(res, 200, { ok: true });
      }
    }

    const rendered = url.pathname.match(/^\/rendered\/([\w-]+)$/);
    if (req.method === "GET" && rendered) {
      const job = jobs.get(rendered[1]);
      if (!job) return send(res, 404, "Expired.", "text/plain");
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        // The rendered email can't run scripts or reach anything but images.
        "Content-Security-Policy": "default-src 'none'; img-src * data:; style-src 'unsafe-inline' *; font-src *",
      });
      return res.end(job.html);
    }

    send(res, 404, { error: "Not found." });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 400, { error: err.message });
  }
});

loadLists();

server.listen(PORT, () => {
  console.log(`EDM checker running on http://localhost:${PORT} (Mailgun ${REGION.toUpperCase()} region)`);
  console.log(`${lists.length} shared client list(s) in ${LISTS_FILE}`);
  if (!APP_PASSWORD) console.log("No APP_PASSWORD set: anyone who can reach this address can use it.");
});
