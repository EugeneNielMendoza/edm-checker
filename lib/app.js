/**
 * EDM checker: all request handling, written as a web-standard handler
 * (Request in, Response out) so the same code runs locally/in Docker (via local-server.js)
 * and on Vercel (via api/index.mjs). Kept out of the project root on purpose: Vercel
 * auto-detects root files named app.js / index.js / server.js as the server entry.
 *
 * Drop a Sesimi EDM template zip on the page: it is rendered to email HTML and sent
 * to Mailgun Email Preview, and the page shows progress and a link to the results.
 *
 * Environment:
 *   MAILGUN_API_KEY        required. Kept on the server, never sent to the browser.
 *   MAILGUN_REGION         "us" (default) or "eu"
 *   APP_PASSWORD           optional but strongly recommended when hosted. If set, the
 *                          site asks for this password (any username).
 *   DATA_DIR               where client lists are saved locally. Default ./data
 *   BLOB_READ_WRITE_TOKEN  set automatically by Vercel when a Blob store is connected;
 *                          client lists are then saved in Vercel Blob instead of DATA_DIR.
 *   BLOB_ACCESS            "private" (default) or "public": the Blob store's access type.
 *   PREVIEW_CLIENTS        optional. Comma-separated client IDs used to create the first
 *   PREVIEW_CLIENTS_NAME   client list (and its name) when none exist yet.
 */
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const AdmZip = require("adm-zip");

const API_KEY = process.env.MAILGUN_API_KEY;
const REGION = (process.env.MAILGUN_REGION || "us").toLowerCase();
const APP_PASSWORD = process.env.APP_PASSWORD || "";
const PREVIEW_CLIENTS = (process.env.PREVIEW_CLIENTS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const PREVIEW_CLIENTS_NAME = (process.env.PREVIEW_CLIENTS_NAME || "Default").trim().slice(0, 60);
// Project root (this file lives in lib/).
const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, "data"));
const LISTS_FILE = path.join(DATA_DIR, "client-lists.json");
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || "";
const BLOB_ACCESS = process.env.BLOB_ACCESS === "public" ? "public" : "private";
const BLOB_PATH = "edm-checker/client-lists.json";
const MAILGUN_BASE =
  process.env.MAILGUN_BASE_URL || // for local testing against a mock only
  (REGION === "eu" ? "https://api.eu.mailgun.net" : "https://api.mailgun.net");

// Vercel rejects request bodies over 4.5 MB before they reach the app.
const MAX_UPLOAD_BYTES = process.env.VERCEL ? Math.floor(4.4 * 1024 * 1024) : 20 * 1024 * 1024;
const MAX_UNZIPPED_BYTES = 50 * 1024 * 1024;
const MAX_JSON_BYTES = 64 * 1024;
const MAX_LISTS = 50;
const RENDER_TIMEOUT_MS = 30_000;
const CLIENTS_CACHE_MS = 60 * 60 * 1000;

function configError() {
  if (!API_KEY) return "MAILGUN_API_KEY is not set. Add it as an environment variable.";
  if (!["us", "eu"].includes(REGION)) return `MAILGUN_REGION must be "us" or "eu", got "${REGION}".`;
  return null;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

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

// ---------- Shared client lists ----------
// Saved in Vercel Blob when BLOB_READ_WRITE_TOKEN is set, otherwise in DATA_DIR/client-lists.json.
// Every read is fresh (hosted instances don't share memory); writes are conditional on the
// version that was read, so two people saving at once can't silently overwrite each other.

function seedLists() {
  return PREVIEW_CLIENTS.length ? [{ id: crypto.randomUUID(), name: PREVIEW_CLIENTS_NAME, clients: PREVIEW_CLIENTS }] : [];
}

const fileStore = {
  async read() {
    try {
      const text = await fsp.readFile(LISTS_FILE, "utf8");
      return { lists: JSON.parse(text), version: crypto.createHash("sha1").update(text).digest("hex") };
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
      await this.write(seedLists(), null);
      const text = await fsp.readFile(LISTS_FILE, "utf8");
      return { lists: JSON.parse(text), version: crypto.createHash("sha1").update(text).digest("hex") };
    }
  },
  writing: Promise.resolve(),
  async write(lists, version) {
    const run = this.writing.then(async () => {
      if (version) {
        const current = await this.read();
        if (current.version !== version) throw new HttpError(409, "Someone else just changed the lists. Reload the page and try again.");
      }
      await fsp.mkdir(DATA_DIR, { recursive: true });
      const tmp = `${LISTS_FILE}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify(lists, null, 2));
      await fsp.rename(tmp, LISTS_FILE);
    });
    this.writing = run.catch(() => {});
    return run;
  },
};

const blobStore = {
  async read(seedIfMissing = true) {
    const { get } = require("@vercel/blob");
    const result = await get(BLOB_PATH, { access: BLOB_ACCESS, useCache: false, token: BLOB_TOKEN });
    if (!result) {
      if (!seedIfMissing) throw new Error("Couldn't read the client lists from Vercel Blob after creating them.");
      try {
        await this.write(seedLists(), null);
      } catch (err) {
        if (!(err instanceof HttpError)) throw err; // someone else seeded it first
      }
      return this.read(false);
    }
    const text = await new Response(result.stream).text();
    return { lists: JSON.parse(text), version: result.blob.etag };
  },
  async write(lists, version) {
    const { put, BlobPreconditionFailedError } = require("@vercel/blob");
    try {
      await put(BLOB_PATH, JSON.stringify(lists, null, 2), {
        access: BLOB_ACCESS,
        token: BLOB_TOKEN,
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: !!version,
        ...(version ? { ifMatch: version } : {}),
      });
    } catch (err) {
      if (err instanceof BlobPreconditionFailedError || /already exists/i.test(err.message)) {
        throw new HttpError(409, "Someone else just changed the lists. Reload the page and try again.");
      }
      throw err;
    }
  },
};

const store = BLOB_TOKEN ? blobStore : fileStore;

async function validateList(lists, body, ignoreId) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 60) throw new HttpError(400, "Give the list a name (up to 60 characters).");
  const clash = lists.find((l) => l.id !== ignoreId && l.name.toLowerCase() === name.toLowerCase());
  if (clash) throw new HttpError(400, `There's already a list called "${clash.name}".`);
  if (!Array.isArray(body.clients) || body.clients.length === 0) throw new HttpError(400, "Pick at least one email client.");
  const known = new Set((await getAllClients()).map((c) => c.id));
  const clients = [...new Set(body.clients.map(String))];
  const unknown = clients.filter((id) => !known.has(id));
  if (unknown.length) throw new HttpError(400, `Mailgun doesn't recognise these clients: ${unknown.slice(0, 5).join(", ")}`);
  return { name, clients };
}

// ---------- Rendering ----------

async function unzipSafely(buffer, destDir) {
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new HttpError(400, "That file isn't a valid zip.");
  }
  const root = path.resolve(destDir);
  let total = 0;
  for (const entry of zip.getEntries()) {
    const target = path.resolve(root, entry.entryName);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new HttpError(400, `The zip contains an unsafe path (${entry.entryName}).`);
    }
    total += entry.header.size;
    if (total > MAX_UNZIPPED_BYTES) throw new HttpError(400, "The zip is too large once unpacked.");
  }
  zip.extractAllTo(root, true);
}

function renderTemplate(dir) {
  // Real paths: on macOS the temp folder (/var/...) is a symlink to /private/var/...,
  // and require() opens the real path, which the permission allow-list must match.
  // Only the template, the worker script and node_modules are readable — not the whole app
  // folder, which can hold .env (the API key) and the saved client lists.
  const templateDir = fs.realpathSync(dir);
  const worker = fs.realpathSync(path.join(ROOT, "render_worker.js"));
  const modules = fs.realpathSync(path.join(ROOT, "node_modules"));
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
        if (parsed && parsed.error) return reject(new HttpError(400, parsed.error));
        if (err) {
          if (err.killed) return reject(new HttpError(400, "Rendering took too long and was stopped."));
          console.error("Render failed:", stderr || err.message);
          return reject(new Error("The template couldn't be rendered. See the server log for details."));
        }
        if (!parsed || !Array.isArray(parsed.pages)) return reject(new Error("The renderer returned no pages."));
        resolve(parsed.pages);
      }
    );
  });
}

// ---------- HTTP helpers ----------

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function authorized(request) {
  if (!APP_PASSWORD) return true;
  const header = request.headers.get("authorization") || "";
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
function sameSiteError(request, url) {
  const h = request.headers;
  const site = h.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return "Requests from other websites aren't allowed.";
  const origin = h.get("origin");
  if (origin) {
    let host = "";
    try {
      host = new URL(origin).host;
    } catch {}
    const allowed = [h.get("host"), h.get("x-forwarded-host")].filter(Boolean);
    if (!allowed.includes(host)) return "Requests from other websites aren't allowed.";
  }
  const type = (h.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (url.pathname === "/api/checks" && type !== "application/zip") return "Upload the zip from the page.";
  if (url.pathname.startsWith("/api/lists") && request.method !== "DELETE" && type !== "application/json") {
    return "Send list changes as JSON from the page.";
  }
  return null;
}

async function readBody(request, limit, tooBig) {
  if (Number(request.headers.get("content-length") || 0) > limit) throw new HttpError(413, tooBig);
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      reader.cancel().catch(() => {});
      throw new HttpError(413, tooBig);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function readJson(request) {
  const body = await readBody(request, MAX_JSON_BYTES, "That request is too large.");
  try {
    return JSON.parse(body.toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "That request isn't valid JSON.");
  }
}

// ---------- Routes ----------

async function handleCheck(request, url) {
  const fileName = (url.searchParams.get("name") || "template.zip").slice(0, 200);
  const subject = (url.searchParams.get("subject") || "").trim() || fileName.replace(/\.zip$/i, "");
  const listId = url.searchParams.get("list") || "";
  let list = null;
  if (listId) {
    list = (await store.read()).lists.find((l) => l.id === listId);
    if (!list) throw new HttpError(400, "That client list no longer exists. Pick another one.");
  }

  const mb = Math.round(MAX_UPLOAD_BYTES / 1024 / 1024 * 10) / 10;
  const body = await readBody(request, MAX_UPLOAD_BYTES, `The zip is larger than ${mb} MB.`);
  if (body.length === 0) throw new HttpError(400, "No file was received.");

  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "edm-"));
  try {
    await unzipSafely(body, tmp);
    const pages = await renderTemplate(tmp);

    const checks = [];
    for (const page of pages) {
      const pageSubject = pages.length > 1 ? `${subject} (page ${page.id})` : subject;
      const { testId, warnings } = await createPreviewTest(page.html, pageSubject, list && list.clients);
      const on = list ? `"${list.name}" (${list.clients.length} clients)` : "Mailgun default clients";
      log(`${fileName} page ${page.id} on ${on} -> Mailgun test ${testId}`);
      checks.push({ page: page.id, testId, subject: pageSubject, warnings, html: page.html });
    }
    return json(200, { checks });
  } finally {
    fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

async function handleStatus(testId) {
  const progress = await getProgress(testId);
  const complete = progress.total > 0 && progress.done === progress.total;
  let shareUrl = null;
  if (complete) {
    try {
      shareUrl = await getShareUrl(testId);
    } catch (err) {
      console.error("Share link failed:", err.message);
    }
  }
  return json(200, { ...progress, complete, shareUrl });
}

async function handleLists(request, url) {
  const listMatch = url.pathname.match(/^\/api\/lists\/([\w-]+)$/);
  if (url.pathname === "/api/lists" && request.method === "GET") {
    return json(200, { lists: (await store.read()).lists });
  }
  if (url.pathname === "/api/lists" && request.method === "POST") {
    const body = await readJson(request);
    const { lists, version } = await store.read();
    if (lists.length >= MAX_LISTS) throw new HttpError(400, `There are already ${MAX_LISTS} lists. Delete one first.`);
    const list = { id: crypto.randomUUID(), ...(await validateList(lists, body)) };
    await store.write([...lists, list], version);
    log(`Client list created: "${list.name}" (${list.clients.length})`);
    return json(201, { list });
  }
  if (listMatch && (request.method === "PUT" || request.method === "DELETE")) {
    const body = request.method === "PUT" ? await readJson(request) : null;
    const { lists, version } = await store.read();
    const index = lists.findIndex((l) => l.id === listMatch[1]);
    if (index === -1) throw new HttpError(404, "That client list no longer exists.");
    const next = [...lists];
    if (request.method === "PUT") {
      next[index] = { ...lists[index], ...(await validateList(lists, body, lists[index].id)) };
      await store.write(next, version);
      log(`Client list updated: "${next[index].name}" (${next[index].clients.length})`);
      return json(200, { list: next[index] });
    }
    const [removed] = next.splice(index, 1);
    await store.write(next, version);
    log(`Client list deleted: "${removed.name}"`);
    return json(200, { ok: true });
  }
  return null;
}

const PAGE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
};

async function handle(request) {
  try {
    const problem = configError();
    if (problem) {
      console.error(problem);
      return json(500, { error: problem });
    }
    if (!authorized(request)) {
      return new Response("Password required.", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="EDM checker"' } });
    }
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      const blocked = sameSiteError(request, url);
      if (blocked) {
        console.warn(`[${new Date().toISOString()}] Blocked ${request.method} ${url.pathname}: ${blocked} (origin: ${request.headers.get("origin") || "none"})`);
        return json(403, { error: blocked });
      }
    }

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return new Response(await fsp.readFile(path.join(ROOT, "web", "index.html")), { headers: PAGE_HEADERS });
    }
    if (request.method === "GET" && url.pathname === "/api/config") {
      return json(200, { maxUploadBytes: MAX_UPLOAD_BYTES });
    }
    if (request.method === "POST" && url.pathname === "/api/checks") return await handleCheck(request, url);
    const status = url.pathname.match(/^\/api\/checks\/([\w-]+)$/);
    if (request.method === "GET" && status) return await handleStatus(status[1]);
    if (request.method === "GET" && url.pathname === "/api/clients") return json(200, { clients: await getAllClients() });
    if (url.pathname.startsWith("/api/lists")) {
      const res = await handleLists(request, url);
      if (res) return res;
    }
    return json(404, { error: "Not found." });
  } catch (err) {
    if (!(err instanceof HttpError)) console.error(err);
    return json(err instanceof HttpError ? err.status : 400, { error: err.message });
  }
}

module.exports = { handle, configError, storeName: () => (BLOB_TOKEN ? `Vercel Blob (${BLOB_PATH})` : LISTS_FILE) };
