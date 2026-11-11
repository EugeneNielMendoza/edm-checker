// Vercel entry point: every request is routed here (see vercel.json) and handled by app.js.
import app from "../app.js";

export default {
  fetch: (request) => app.handle(request),
};
