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
// Comma-separated Mailgun client IDs to test on. Empty = Mailgun's default clients.
const PREVIEW_CLIENTS = (process.env.PREVIEW_CLIENTS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const MAILGUN_BASE =
  process.env.MAILGUN_BASE_URL || // for local testing against a mock only
  (REGION === "eu" ? "https://api.eu.mailgun.net" : "https://api.mailgun.net");

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
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

async function createPreviewTest(html, subject) {
  // ASSUMPTION: v2 accepts the same fields as the documented v1 endpoint.
  const result = await mailgun("POST", "/v2/preview/tests", {
    subject,
    html,
    ...(PREVIEW_CLIENTS.length ? { clients: PREVIEW_CLIENTS } : {}),
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
  const templateDir = fs.realpathSync(dir);
  const appDir = fs.realpathSync(__dirname);
  const args = [
    "--permission",
    `--allow-fs-read=${templateDir}`,
    `--allow-fs-read=${appDir}`,
    path.join(__dirname, "render_worker.js"),
    templateDir,
  ];
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      args,
      {
        timeout: RENDER_TIMEOUT_MS,
        maxBuffer: 20 * 1024 * 1024,
        env: { NODE_PATH: path.join(__dirname, "node_modules"), PATH: process.env.PATH },
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

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) {
        reject(new Error("The zip is larger than 20 MB."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function handleCheck(req, res, url) {
  const fileName = (url.searchParams.get("name") || "template.zip").slice(0, 200);
  const subject = (url.searchParams.get("subject") || "").trim() || fileName.replace(/\.zip$/i, "");

  const body = await readBody(req);
  if (body.length === 0) return send(res, 400, { error: "No file was received." });

  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "edm-"));
  try {
    await unzipSafely(body, tmp);
    const pages = await renderTemplate(tmp);

    const checks = [];
    for (const page of pages) {
      const pageSubject = pages.length > 1 ? `${subject} (page ${page.id})` : subject;
      const { testId, warnings } = await createPreviewTest(page.html, pageSubject);
      jobs.set(testId, { html: page.html, subject: pageSubject, fileName, createdAt: Date.now(), shareUrl: null });
      console.log(`[${new Date().toISOString()}] ${fileName} page ${page.id} -> Mailgun test ${testId}`);
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

    if (req.method === "GET" && url.pathname === "/") {
      return send(res, 200, fs.readFileSync(path.join(__dirname, "public", "index.html")), "text/html; charset=utf-8");
    }
    if (req.method === "POST" && url.pathname === "/api/checks") {
      return await handleCheck(req, res, url);
    }
    const status = url.pathname.match(/^\/api\/checks\/([\w-]+)$/);
    if (req.method === "GET" && status) return await handleStatus(res, status[1]);

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

server.listen(PORT, () => {
  console.log(`EDM checker running on http://localhost:${PORT} (Mailgun ${REGION.toUpperCase()} region)`);
  console.log(PREVIEW_CLIENTS.length ? `Testing on ${PREVIEW_CLIENTS.length} clients from PREVIEW_CLIENTS.` : "PREVIEW_CLIENTS not set: testing on Mailgun's default clients.");
  if (!APP_PASSWORD) console.log("No APP_PASSWORD set: anyone who can reach this address can use it.");
});
