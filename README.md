# PlainMile PDF Tools

A free, browser-local PDF workspace intended for `https://pdf.plainmile.com/`.

**Status:** V0 deployed to `https://pdf.plainmile.com` on netcup; production release checks must keep passing after each change. Use the GH Actions deployment record to confirm current status.

## Self-host the public image

**Official website:** https://pdf.plainmile.com/  
**Open-source repository:** https://github.com/plainmile/pdf-tools  
**GHCR image:** `ghcr.io/plainmile/pdf-tools:latest` (Linux, current release)

The unmodified self-hosted image includes a **visible, localized 'Official site: pdf.plainmile.com' link in every page footer**. This gives visitors a visible source attribution without a tracking pixel or hidden link. The distributed footer uses `rel="nofollow"`: Google's spam guidance specifically warns against building ranking credit through links widely repeated in third-party website templates or footers. This credit is for people to identify and reach the original project, **not** a scheme for automatic backlinks or a promise of ranking improvement. The site also ships canonical and hreflang URLs for the official domain, so unchanged copies may be recognized as duplicate content. Forks that want their own URLs indexed should rebuild the site with their own `Astro.site`/canonical, language-alternate and structured-data origins rather than relying on those official metadata defaults.

Once the package visibility is set to **Public** in [GitHub Packages](https://github.com/orgs/plainmile/packages), no GHCR account, login, source build, API key or GPU is needed. A browser does all PDF processing locally.

**Option A — run a ready-made Docker image:**

```sh
docker pull ghcr.io/plainmile/pdf-tools:latest
docker run -d --name pdf-tools --restart unless-stopped \
  -p 8080:80 ghcr.io/plainmile/pdf-tools:latest
# Open http://localhost:8080
```

**Option B — use Docker Compose (recommended for easy upgrades):**

```sh
curl -fsSL https://raw.githubusercontent.com/plainmile/pdf-tools/main/compose.selfhost.yaml -o compose.yaml
docker compose -f compose.yaml up -d
# Open http://localhost:8080
# Upgrade: docker compose -f compose.yaml pull && docker compose -f compose.yaml up -d
```

The self-host Compose example is **standalone**: it does not require PlainMile's private `edge` network, netcup SSH secrets, a database, any volumes, or a fixed container name. You may select a different host port with `PDF_TOOLS_PORT=8081 docker compose -f compose.yaml up -d`.

**HTTP LAN self-hosts:** Import IDs use the browser's secure random source with an HTTP-safe fallback (`crypto.getRandomValues`) when `crypto.randomUUID()` is unavailable. You may open the container from another device on your private LAN via `http://LAN-IP:8080`; for any public exposure, use HTTPS and a reverse proxy. This fallback does not make HTTP transport secure.

**Hosting on a public server?** The example binds the HTTP port on all network interfaces; use a HTTPS reverse proxy and restrict direct port exposure in production. To allow *local-only* access, replace `8080:80` with `127.0.0.1:8080:80` or run `docker run -p 127.0.0.1:8080:80 ...`. The original documents never leave visitors' browsers.

For reproducibility, pin a reviewed image digest or immutable commit-SHA tag instead of `latest`. The [GitHub Actions releases](https://github.com/plainmile/pdf-tools/actions/workflows/publish.yml) publish SHA-tagged images after CI succeeds.

**Image labels** expose the official site (`org.opencontainers.image.url`), source repository, MIT license and documentation. Check with:

```sh
docker image inspect ghcr.io/plainmile/pdf-tools:latest \
  --format '{{index .Config.Labels "org.opencontainers.image.url"}}'
# Expected: https://pdf.plainmile.com/
```

## Report a problem or suggest a workflow

Use the visible **Report an issue / 反馈问题** link in the website footer, or open [GitHub Issues](https://github.com/plainmile/pdf-tools/issues/new/choose). Include the page URL, exact non-sensitive steps, expected versus actual result, browser, and approximate file type/size/page count. **Do not upload or paste original documents, extracted text, file names, account details, or other personal information.** Reproduce with a synthetic document whenever possible. The tool runs locally; issue reports are public and are not part of document processing.

## Features

- Merge PDFs at the page level, including interleaving pages from different files.
- Drag individual thumbnails or selected groups of pages to reorder; Shift selection and touch/keyboard move buttons are supported.
- Select, rotate, delete, extract and undo/redo up to 20 edits.
- Split by page ranges (`1-3, 4-6`) or every N pages, bundled in a ZIP download.
- Convert JPG, PNG and WebP to PDF pages with A4 / US Letter / fit-to-image sizes, automatic / portrait / landscape orientation and four margin presets. Choose **fit entire image** (no crop) or **fill available paper area** (centered crop; never stretches). Fit-to-image always shows the entire source image. Supports mixed images/PDFs, per-page thumbnails, drag ordering, explicit numeric filename sorting and reverse ordering with Undo.
- Optional text watermarks: **off by default**. Open Export options near the download button, enable the checkbox and enter your own text (English or Chinese). The light diagonal overlay is added on export only and also works for extracted/split PDFs. No automatic company watermark.
- No upload API, account, server-side PDF processing, analytics or advertising code.
- Human-written bilingual English / Simplified Chinese SEO pages: `/workspace/`, `/merge-pdf/`, `/split-pdf/`, `/organize-pdf/`, `/rotate-pdf/`, `/extract-pages/`, `/delete-pages/`, `/image-to-pdf/`, `/watermark-pdf/`, `/privacy/` plus `/zh/` counterparts. Hreflang and canonical tags provided.
- Three appearance modes: follow system, light, dark. Preference saved locally if the browser allows localStorage; all modes are CSS token-based.

## Important safety and editing behavior

- **Merge/organize/rotate/extract/split** create a *new* PDF by copying pages. Interactive forms, signed documents, embedded attachments and some annotations may be lost, or signatures invalidated. These operations are not certified archival or preservation workflows. Keep the original and compare important exports.
- **Image-to-PDF paper choices:** A4 / Letter / image-sized; portrait, landscape or auto for fixed paper, while image-sized always follows each image. Margins: 0/12/30/48 pt. The default remains A4 portrait, 30 pt, full image. Cover mode explicitly crops overflowing image edges to the printable area, not outside the page. Any layout changes to loaded photos must be applied before exporting; Undo and page order are preserved.
- **Image ordering:** Image-only workspaces offer natural numeric filename ordering (`photo2` before `photo10`) and reverse order; drag/individual move controls remain available. Neither automatic sort nor irreversible mutation occurs upon import.
- **Unexpected settings and long exports:** Switching to fit-to-image explicitly resets the previously selected destructive cover/crop mode, so switching back to A4 does not silently crop. Importing a new photo after removing earlier photos resets the active layout even if other PDF pages remain. For exports of 24+ pages, the UI reports progress and offers cooperative cancellation; a cancelled operation never triggers a partial download.
- **Compression is intentionally lossy:** Every page becomes JPEG content; searchable text, forms, annotations, links and signatures are not preserved. The output is offered only when its *measured* size is smaller. Never treat this as a lossless compression or secure redaction service.

## Limits and known non-goals

- Workspace: up to 20 input files, 100 MiB per file, 200 MiB combined, 600 pages. Only visible/nearby page thumbnails are rendered. Large books can still require substantial device memory; smaller/mobile devices may fail earlier. Images must not exceed 36 megapixels.
- Import requires PDFs supported by `pdf-lib`; malformed, encrypted or password-protected PDFs are rejected. Some valid but unusual PDFs may be rejected.
- PDF form-field compatibility, annotations, complex digital signatures and metadata preservation are not guaranteed when pages are copied. **Review exported documents carefully.**
- Not a PDF to Word, OCR, secure redaction or cryptographic signature tool. Compression is lossy rasterization, not lossless optimization.
- Source documents are not sent to any server. The generated PDF exists in browser memory until download. Hosting infrastructure may still record routine HTTP requests for website assets.
- Browser performance depends on device RAM/CPU, especially for large documents.
- Watermarks are visual overlays, **not** secure redactions or digital signatures. Watermark text is rendered using local system fonts and rasterized into each exported PDF page (no external font download). If your device does not have a suitable Chinese font, preview and output may show fallback glyphs; check important exports. Preview overlays on thumbnails are approximate.
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
- Watermark default-off, custom English and Chinese text, actual PDF page image overlays, disable/reset behavior, and optional watermarking in extracted and split outputs.

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

MIT License. See [LICENSE](LICENSE). Source: https://github.com/plainmile/pdf-tools.

## Required CI and public release gates

1. Every `feature/**` push, PR update, and `main` push triggers unit/build and browser E2E on the built production Docker image. CI uses per-branch concurrency to cancel obsolete runs and caps the runner duration.
2. Successful CI of the **exact main commit** triggers `Publish Image` to GHCR. CI failures must never trigger publication.
3. `Deploy PDF Tools to netcup` consumes the published SHA, copies Compose, deploys, and checks container health and public HTTPS.
4. **Inside the same deployment GitHub-hosted Runner**, 20+ public Playwright scenarios run against `https://pdf.plainmile.com`, with PDF uploads and actual downloaded PDF content verification. A failing public test makes the deployment workflow red even if the container is healthy.
5. E2E Docker containers use `--rm` and explicit `if: always()` cleanup. GitHub-hosted Runners are discarded after the job. Diagnostics are kept only on failure, for one day. The separate public QA workflow is **manual-only** to avoid duplicate Runner jobs.

The repository is public; GitHub's **standard hosted Runners** are free for public repositories, but artifact/package storage can still be limited. No always-on QA Runner or daemon is configured on netcup.

## Workflow design references

Borrow the practical interaction patterns found in PDF24, iLovePDF and Smallpdf, without cloning their branding or page layout: surface relevant controls before converting; show the actual order and preview; preserve original files; clearly separate reversible page editing from lossy conversions; explain file/page safety limits beside the action; and offer optional follow-on tools after a successful result. All processing remains browser-local; there are no user accounts or uploads.

## V1 browser-local utility tools

- **PDF to PNG/JPG:** Render selected pages to images; multiple pages download as ZIP. Supports resolution and page-range controls.
- **PDF compression:** Optional *lossy image-based* recompression with actual original and result sizes. If output is larger, download is disabled. Lossy compression **removes searchable/selectable text and may lose links, interactive forms, signatures and annotations**. Keep your original.
- **PDF to TXT/Markdown:** Extract pre-existing selectable text using PDF.js. No OCR; multi-column/tables may reorder or flatten. Markdown headings are heuristic.
- **TXT/Markdown to PDF:** Simple local A4 output, limited Markdown syntax (headings/lists/quotes/code). Latin text is selectable; Unicode/CJK text is drawn using local browser fonts as **image-only** pages (no search/copy). No remote resources or HTML execution.
- **Add page numbers:** Select starting number, position and font size; actual numbers are drawn into each PDF page.
- **PDF to TXT/Markdown and page numbering:** PDF input up to **100 MiB and 1,000 pages**. Page counting uses PDF.js; extraction parses one page at a time and cleans up PDF.js page resources. Numbering uses pdf-lib and may need additional RAM for very large PDFs.
- **PDF to JPG/PNG:** PDFs up to 100 MiB/1,000 pages, but each browser export is limited to **60 selected pages**. A 500-page document can export `301-360`; export the next batch separately. Each canvas is capped at **12 megapixels**. The final ZIP is held in browser memory; use batches to control RAM.
- **Image-based PDF compression:** PDFs up to 100 MiB, **120 pages per document** per run. Larger books should be split first. JPEG recompression rasterizes text and can lose hyperlinks/annotations, so this cap is intentionally lower than for text extraction. Files are downloaded only when the result is smaller.
- **TXT/Markdown import:** up to **5 MiB UTF-8**. Latin-only text can produce up to 1,000 PDF pages; Unicode/CJK image-based rendering is capped at 300 pages because it uses significantly more memory. The 5 MiB input ceiling does not guarantee every document will fit into the output page limit.
- Limits are browser-side safety ceilings, **not** a promise that every device can handle the maximum. No file bytes are transmitted to the server. Long operations show page progress, and batch rendering releases each page's canvas and PDF.js worker memory.

This project is licensed under **MIT**, and the website footer links to the open-source repository: https://github.com/plainmile/pdf-tools.


## Navigation and helpful-content SEO (2026-10)

- The home page follows a straightforward document-utility pattern rather than a promotional SaaS landing page: four **popular tasks**, four descriptive categories, keyboard-operable client-side tool search and 16 **server-rendered** tool links. Search is an enhancement; tools stay visible and crawlable with JavaScript disabled.
- Each tool page includes a real **How it works** section, two visible user questions with accurate limitations, and **contextual related-tool links**. Do not add fabricated customer reviews, fake star ratings, boilerplate keyword sections or FAQ rich-result markup.
- Static structured data: home `WebSite`; tool pages `WebApplication` + `BreadcrumbList`. Both languages use real page-specific content, canonical URLs and reciprocal `hreflang` links. JSON-LD does **not** guarantee Google rich results, inclusion in AI search or rankings.
- Desktop and mobile typography, text contrast, navigation, focus/keyboard usage, tool filters and dark/light/system themes are covered by unit, browser E2E and public-runner checks. Record actual deployed URL results rather than relying on local screenshots.

## Faster conversion workflow (2026-10)

- All seven standalone converters accept local files by **native file picker or drag-and-drop**. The UI makes the privacy behavior obvious: browser-local document bytes are never uploaded. TXT/Markdown imports show the imported file name and provide Clear.
- Book-length **PDF to JPG/PNG** no longer starts with an impossible 300-page default. For PDFs longer than 60 pages, the page selector automatically suggests `1-60` and has keyboard-operable **Previous/Next pages** controls. For 125 pages, the batches are `1-60`, `61-120`, `121-125`. A custom range remains supported and batch ZIP names include the selected page range to avoid confusing downloads.
- The per-run **60-image** and per-page **12 MP** safety limits are unchanged. Static bilingual tool landing content, canonical/hreflang, schema and search indexing remain unchanged.
