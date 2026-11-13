import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// The page lives in client/ and is built into dist/.
//
// The HTML file is called app.html (not index.html) on purpose: on Vercel, dist/ is served as
// static files, and a dist/index.html would be served at "/" without going through the server,
// skipping the APP_PASSWORD check. With app.html, "/" always reaches the server, which sends
// the page after checking the password. The JS/CSS in dist/assets/ hold no secrets.

// In development, serve app.html at "/" like the real server does.
const serveAppAtRoot: Plugin = {
  name: "serve-app-at-root",
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url === "/" || req.url?.startsWith("/?")) req.url = "/app.html";
      next();
    });
  },
};

export default defineConfig({
  root: "client",
  plugins: [react(), serveAppAtRoot],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: { input: fileURLToPath(new URL("./client/app.html", import.meta.url)) },
  },
  server: {
    // `npm run dev` (this page, with hot reload) talks to the API of `npm run server` on port 3000.
    proxy: { "/api": "http://localhost:3000" },
  },
});
