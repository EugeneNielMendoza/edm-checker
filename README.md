# EDM checker

A small internal web page: drop a Sesimi EDM template zip, and it is rendered
to email HTML (with the zip's sample data) and sent to Mailgun Email Preview.
The page shows the rendered email, progress, and a link to the results in Mailgun.

## Run it

Needs Node 22.13+ (or Docker) and a Mailgun API key with Email Preview access.

```
npm install
MAILGUN_API_KEY=your-key APP_PASSWORD=choose-one npm start
```

Then open http://localhost:3000.

Or keep settings in a `.env` file (ignored by git) and run `node --env-file=.env local-server.js`.

With Docker:

```
docker build -t edm-checker .
docker run -p 3000:3000 -v edm-data:/app/data -e MAILGUN_API_KEY=your-key -e APP_PASSWORD=choose-one edm-checker
```

## Deploy on Vercel

The same code (`lib/app.js`) runs on Vercel via `api/index.mjs` + `vercel.json`; `local-server.js` is only for
local/Docker. Don't add `app.js`, `index.js` or `server.js` at the project root: Vercel auto-detects those
names as the server entry and ignores `api/`.

1. Import the GitHub repo in Vercel (Framework preset: **Other**, no build command).
2. **Storage → Create → Blob**, choose **Private** access, and connect it to the project.
   Vercel then sets `BLOB_READ_WRITE_TOKEN`, and client lists are saved there.
3. **Settings → Environment Variables**: add `MAILGUN_API_KEY` (mark it Sensitive),
   `APP_PASSWORD`, and optionally `PREVIEW_CLIENTS` / `PREVIEW_CLIENTS_NAME` /
   `MAILGUN_REGION`. Redeploy after adding them.
4. Open the deployment, enter the password, and run one check end to end.

Limits on Vercel: zips up to about 4.4 MB (Vercel's request limit), 60-second requests.

## Settings (environment variables)

| Variable | Required | Meaning |
|---|---|---|
| MAILGUN_API_KEY | yes | Stays on the server; never sent to the browser. |
| MAILGUN_REGION | no | `us` (default) or `eu`. |
| APP_PASSWORD | strongly recommended | Visitors must enter it (any username). |
| PORT | no | Default 3000. |
| DATA_DIR | no | Where shared client lists are saved (`client-lists.json`). Default `./data`. In Docker, mount a volume at `/app/data` so lists survive redeploys. |
| BLOB_READ_WRITE_TOKEN | on Vercel | Set by Vercel when a Blob store is connected; lists are then saved in Blob instead of `DATA_DIR`. |
| BLOB_ACCESS | no | `private` (default) or `public`, matching the Blob store. |
| PREVIEW_CLIENTS | no | Comma-separated client IDs for the first client list, used only when no lists exist yet. |
| PREVIEW_CLIENTS_NAME | no | Name of that first list (e.g. `APAC CHECKER`). Default `Default`. |

## Security notes

- Template zips contain code. The server runs it in a separate Node process with
  Node's permission model: it can only read the template, the renderer script and
  `node_modules` (not `.env` or the saved lists), can't write files and can't start
  other programs, with a 30-second limit. It can still make network requests.
  Treat that as a safety net, not a guarantee, and always set APP_PASSWORD when
  the app is reachable by anyone else (on Vercel it's on the public internet).
- Requests that change anything must come from the app's own page (cross-site
  requests are rejected).
- Uploads are limited to 20 MB locally / ~4.4 MB on Vercel (50 MB unpacked). Nothing
  is kept on the server except the client lists; the upload's temp folder is deleted
  after each check.
- Client templates are sent to Mailgun, the same as checking them by hand.

## Mailgun API notes (confirmed against a live account)

1. `POST /v2/preview/tests` accepts `subject`, `html`, `content_checking` and an optional
   `clients` array of client IDs (list them with `GET /v1/preview/tests/clients`).
2. Each client in `GET /v1/preview/tests/{id}/results` has a `status` that becomes `Complete`.
3. Share links: `POST /v1/preview/sharing` with `{ "test_id": ... }` only turns sharing on
   (it returns `"record created"`); `GET /v1/preview/sharing/{test_id}` returns the public
   `url` (expires after about 90 days).
4. Mailgun saved profiles (e.g. "APAC CHECKER") aren't available through the API, so the app
   keeps its own shared client lists, which anyone using the page can create, edit or delete.

The rendering reproduces what the template code produces; compare one result
with a real export from the Sesimi app to confirm they match.
