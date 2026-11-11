/**
 * Render an unzipped Sesimi EDM template bundle to email HTML.
 *
 * Runs as a child process started by lib/app.js with Node's permission model
 * (--permission): it may only READ the template folder and this app's own
 * files, and cannot write files or start other processes. The template is
 * code from a zip, so it is treated as untrusted.
 *
 * Usage: node --permission ... render_worker.js <template-folder>
 * Prints JSON to stdout: { pages: [{ id, html }] }
 */
global.window = globalThis; // mjml-browser expects a browser global

const fs = require("fs");
const path = require("path");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

function fail(message) {
  process.stdout.write(JSON.stringify({ error: message }));
  process.exit(1);
}

const templateDir = process.argv[2];
if (!templateDir) fail("No template folder given.");

const valuesPath = path.join(templateDir, "data", "values.json");
if (!fs.existsSync(valuesPath)) fail("This zip has no data/values.json, so it doesn't look like a Sesimi template.");

let values;
try {
  values = JSON.parse(fs.readFileSync(valuesPath, "utf8"));
} catch {
  fail("data/values.json in this zip isn't valid JSON.");
}

const pagesDir = path.join(templateDir, "pages");
const pageIds = fs.existsSync(pagesDir)
  ? fs.readdirSync(pagesDir).filter((d) => fs.existsSync(path.join(pagesDir, d, "index.js")))
  : [];
if (pageIds.length === 0) fail("This zip has no pages/<id>/index.js, so it doesn't look like a Sesimi template.");

const pages = [];
for (const id of pageIds) {
  let markup;
  try {
    const mod = require(path.resolve(pagesDir, id, "index.js"));
    const Component = mod.default || mod;
    markup = renderToStaticMarkup(
      React.createElement(Component, { global: values.global || {}, page: values[id] || {} })
    );
  } catch (err) {
    fail(`Page ${id} failed to render: ${err.message}`);
  }

  // The template wraps the email in a preview <div>; keep only the email document.
  const start = markup.toLowerCase().indexOf("<!doctype html");
  const end = markup.lastIndexOf("</html>");
  if (start === -1 || end === -1) fail(`Page ${id} didn't produce an email document. Is this an email template?`);

  pages.push({ id, html: markup.slice(start, end + "</html>".length) });
}

process.stdout.write(JSON.stringify({ pages }));
