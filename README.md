# PlainMile PDF Tools

A free, browser-local PDF workspace intended for `https://pdf.plainmile.com/`.

**Status:** V0 feature-branch implementation for `plainmile/pdf-tools`. The user has created the repository and configured `pdf.plainmile.com` DNS and edge Nginx. Production is **not** considered deployed until the CI, publication, deployment and HTTPS checks have succeeded.

## Features

- Merge PDFs at the page level, including interleaving pages from different files.
- Drag individual thumbnails or selected groups of pages to reorder; Shift selection and touch/keyboard move buttons are supported.
- Select, rotate, delete, extract and undo/redo up to 20 edits.
- Split by page ranges (`1-3, 4-6`) or every N pages, bundled in a ZIP download.
- Convert JPG, PNG and WebP to A4 PDF pages and mix with other PDFs.
- No upload API, account, server-side PDF processing, analytics or advertising code.
- Human-written bilingual English / Simplified Chinese SEO pages: `/workspace/`, `/merge-pdf/`, `/split-pdf/`, `/organize-pdf/`, `/rotate-pdf/`, `/extract-pages/`, `/delete-pages/`, `/image-to-pdf/`, `/privacy/` plus `/zh/` counterparts. Hreflang and canonical tags provided.
- Three appearance modes: follow system, light, dark. Preference saved locally if the browser allows localStorage; all modes are CSS token-based.

## Limits and known non-goals

- 20 input files, 25 MB per input file, 100 MB combined input, 200 current PDF pages; images must not exceed 36 megapixels.
- Import requires PDFs supported by `pdf-lib`; malformed, encrypted or password-protected PDFs are rejected. Some valid but unusual PDFs may be rejected.
- PDF form-field compatibility, annotations, complex digital signatures and metadata preservation are not guaranteed when pages are copied. **Review exported documents carefully.**
- Not a PDF to Word, OCR, PDF compression, secure redaction or cryptographic signature tool.
- Source documents are not sent to any server. The generated PDF exists in browser memory until download. Hosting infrastructure may still record routine HTTP requests for website assets.
- Browser performance depends on device RAM/CPU, especially for large documents.
- Native drag-and-drop may vary on touch devices. Dedicated move buttons are supported there.

## Architecture

Astro static HTML + React interactive island, PDF.js 6 page previews, `pdf-lib` PDF authoring, JSZip split downloads, Nginx static hosting. PDF.js worker is copied to `public/pdfjs/` at build time and served from the same origin. No GPU, OCR/LLM, API key or application database is needed.

All application commands on your **own machines or VPS** must run **inside Docker**. Do not install Node/npm on the VPS.

## Run locally with Docker

```sh
docker compose -f compose.dev.yaml up -d
# Open http://127.0.0.1:4321
docker compose -f compose.dev.yaml logs -f dev
```

If Docker Compose is not available, build a production container instead:

```sh
docker build -t plainmile-pdf-tools:local .
docker run --rm -p 127.0.0.1:8082:80 plainmile-pdf-tools:local
# Open http://127.0.0.1:8082
```

### Tests

Unit tests are dependency-free Node tests:

```sh
docker run --rm -v "$PWD:/app" -w /app node:22-bookworm-slim npm run test:unit
```

CI builds the final image, smoke-tests routes and static assets, and runs Playwright E2E **against that production Nginx image** in Docker. Tests generate real PDF fixtures using `pdf-lib` and examine **the exported PDF contents**, not just the UI. E2E checks:

- Cross-file drag-and-drop and exported PDF page order.
- Button-based ordering and exported PDF page order.
- Rotate, delete, undo, extract and exported document correctness.
- Split ranges, ZIP contents and exported page order.
- Reversed ranges and malformed PDF rejection.
- Image conversion to a PDF.
- English / Chinese language routing, accessible language link, three appearance choices and saved preference.
- Group-drag page ordering and Chinese split ZIP exports.

**A successful local unit test is not a substitute for CI or E2E.** Do not merge until GitHub checks pass.

## GitHub workflow

Repository: `https://github.com/plainmile/pdf-tools` (public). Make changes on `feature/*`, open a PR to `main`, and wait for all CI checks including browser-level verification of generated PDF contents before merging. Publishing is handled by `.github/workflows/publish.yml` on `main` and outputs both `latest` and immutable commit-SHA GHCR image tags.

A committed `package-lock.json` is recommended for reproducible builds. CI currently supports an initial unpinned bootstrapping build if the lock is absent; do not claim the release is fully reproducible until the lock has been generated and committed in a separate PR.

## Production deployment on netcup

The user has already configured DNS for `pdf.plainmile.com` and an Nginx host on the existing netcup VPS. Preserve this configuration and the existing PlainMile/InfraOpsX services. The **only** expected reverse proxy target is `http://plainmile-pdf-tools:80` on the existing external Docker network named `edge`.

`compose.prod.yaml` defines an independent static Nginx container, no ports bound to the host and no volumes containing user files. The deployment uses `/opt/data/compose/pdf-tools/` on the VPS. Deployment workflow `.github/workflows/deploy.yml` runs after the GHCR Publish Image workflow successfully publishes the reviewed `main` commit, and checks the new container's health and HTTPS site.

### Configure GitHub Actions secrets (only if they are not already scoped to this repository)

- `DEPLOY_HOST` - netcup SSH hostname/IP
- `DEPLOY_USER` - SSH user with Docker + write access to `/opt/data/compose/pdf-tools/`
- `DEPLOY_PORT` - optional, defaults to 22
- `DEPLOY_SSH_KEY` - SSH private deployment key (secret; never commit)
- `DEPLOY_HOST_KEY` - verified, pinned SSH host **public key**, e.g. `ssh-ed25519 AAAA...` (without the hostname)

Do not copy or reveal secrets through this repository. Do not disable host-key verification. If the GHCR package is private, make it public or configure **read-only** GHCR authentication on the VPS in advance. The workflow does not transmit registry credentials.

### First-run verification

```sh
# Run on netcup VPS; no Node or npm installation needed.
cd /opt/data/compose/pdf-tools
sudo docker compose ps
sudo docker inspect -f '{{.State.Health.Status}}' plainmile-pdf-tools
sudo docker network inspect edge --format '{{range .Containers}}{{println .Name}}{{end}}'
curl -fsSI https://pdf.plainmile.com/
curl -fsSI https://pdf.plainmile.com/workspace/
curl -fsSI https://pdf.plainmile.com/pdfjs/pdf.worker.min.mjs
```

If the GitHub Actions deployment cannot authenticate, it must not alter the shared Nginx or other services. The recovery/manual path is:

```sh
# On netcup VPS only, after the reviewed GHCR image exists:
sudo mkdir -p /opt/data/compose/pdf-tools
cd /opt/data/compose/pdf-tools
# Copy compose.prod.yaml here from the reviewed repository.
printf 'IMAGE_TAG=REVIEWED_MAIN_SHA\n' | sudo tee .env
sudo docker compose pull
sudo docker compose up -d
sudo docker inspect -f '{{.State.Health.Status}}' plainmile-pdf-tools
```

Only the `pdf-tools` service is created or updated. No database migrations, user documents, host ports, or new infrastructure are involved.

## Rollback

With a previous reviewed GHCR image tag, change the server-local `IMAGE_TAG`, run `docker compose -f compose.prod.yaml up -d`, and verify `/healthz`. No user documents or persistent storage need to migrate.

## License

Copyright PlainMile. No redistribution license has been granted yet.
