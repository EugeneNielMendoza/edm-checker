// Vercel entry point: every request is routed here (see vercel.json) and handled by lib/app.js.
import app from "../lib/app.js";

export default {
  fetch: (request) => app.handle(request),
};
