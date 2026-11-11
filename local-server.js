/**
 * Runs the EDM checker as a normal Node server (locally or in Docker).
 * All the logic lives in lib/app.js; on Vercel, api/index.mjs uses it instead of this file.
 * (Not named server.js: Vercel would auto-detect that name as its entry point.)
 *
 *   node --env-file=.env local-server.js      (PORT defaults to 3000)
 */
const http = require("http");
const { Readable } = require("stream");
const app = require("./lib/app");

const PORT = Number(process.env.PORT || 3000);

const problem = app.configError();
if (problem) {
  console.error(problem);
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  try {
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const request = new Request(`http://${req.headers.host || "localhost"}${req.url}`, {
      method: req.method,
      headers: Object.entries(req.headers).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]])),
      body: hasBody ? Readable.toWeb(req) : undefined,
      duplex: "half",
    });
    const response = await app.handle(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body).pipe(res);
    else res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Server error." }));
  }
});

server.listen(PORT, () => {
  console.log(`EDM checker running on http://localhost:${PORT}`);
  console.log(`Client lists saved in ${app.storeName()}`);
  if (!process.env.APP_PASSWORD) console.log("No APP_PASSWORD set: anyone who can reach this address can use it.");
});
