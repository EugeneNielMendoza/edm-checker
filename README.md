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

With Docker:

```
docker build -t edm-checker .
docker run -p 3000:3000 -e MAILGUN_API_KEY=your-key -e APP_PASSWORD=choose-one edm-checker
```

## Settings (environment variables)

| Variable | Required | Meaning |
|---|---|---|
| MAILGUN_API_KEY | yes | Stays on the server; never sent to the browser. |
| MAILGUN_REGION | no | `us` (default) or `eu`. |
| APP_PASSWORD | strongly recommended | Visitors must enter it (any username). |
| PORT | no | Default 3000. |
| PREVIEW_CLIENTS | no | Comma-separated Mailgun client IDs to test on (e.g. the APAC CHECKER list). Empty = Mailgun's default clients. |

## Security notes

- Template zips contain code. The server runs it in a separate Node process with
  Node's permission model: it can only read the template and the app's files,
  can't write files and can't start other programs, with a 30-second limit.
  Treat that as a safety net, not a guarantee: host this only where Sesimi
  staff can reach it (VPN / internal network / SSO proxy), and set APP_PASSWORD.
- Uploads are limited to 20 MB (50 MB unpacked); rendered previews are kept in
  memory for one hour and nothing is written to disk except a temp folder that
  is deleted after each upload.
- Client templates are sent to Mailgun, the same as checking them by hand.

## Assumptions to verify on first real run

These Mailgun details couldn't be confirmed from the public docs; if one is
wrong, the page shows Mailgun's error message:

1. `POST /v2/preview/tests` accepts the v1 fields (`subject`, `html`, `content_checking`).
2. Each client in `GET /v1/preview/tests/{id}/results` has a `status` that becomes `Complete`.
3. `POST /v1/preview/sharing` takes `{ "test_id": ... }` and returns a `url`.

The rendering reproduces what the template code produces; compare one result
with a real export from the Sesimi app to confirm they match.
