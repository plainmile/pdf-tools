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
- Select, rotate, **duplicate**, delete, extract and undo/redo up to 20 edits.
- **Group pages by source PDF:** switch between the true Export order and a read-only per-file view. Each file group can be expanded/collapsed (individually or all at once), and you may select that source's pages in a single click. File grouping does **not** alter export, split, page rotation, selection or Undo order. In grouped view each tile explicitly shows its **real export position**; switch back to Export order to drag/reorder. Duplicated pages appear immediately after their originals with distinct editable page IDs.
- Insert a **blank PDF page** after a single selected page, or at the document's end when no page is selected. The blank follows the visible size/orientation of its neighboring page and contains none of the original page's document contents. With multiple pages selected, choose one before inserting; each new page remains Undo-able.
- For long PDF organizers, the optional **Select by page numbers** control selects current output positions like `1-3, 5, 8-12` (replaces selection, validates before changing anything), including in grouped view.
- **Visual PDF splitting:** click "Cut after this page" beneath the existing lazy page previews; cuts always refer to the **current output order** and create consecutive complete ranges. Click again to undo, or clear all cuts. Manual partial, overlapping and reordered ranges are never silently overwritten: switching to visual cuts asks for confirmation. Typed ranges and every-N splitting remain available. A maximum of 50 output PDFs applies **per download**; for a 1–600-page workspace, every-N splitting (including One PDF per page) creates explicit 50-output batches whenever the result count exceeds 50, with Previous/Next controls and page-range filenames. Batches with only one result download a PDF, otherwise a ZIP; never initiate multiple downloads without a click. Each batch retains the 128 MiB output ceiling and does not count as a full edited-workspace save; use Export PDF to save the entire edited document. One result downloads directly as PDF, multiple as ZIP.
- Convert JPG, PNG, WebP, BMP and **static AVIF** to PDF pages with A4 / US Letter / fit-to-image sizes, automatic / portrait / landscape orientation and four margin presets. Choose **fit entire image** (no crop) or **fill available paper area** (centered crop; never stretches). Fit-to-image always shows the entire source image. Supports mixed images/PDFs, per-page thumbnails, drag ordering, explicit numeric filename sorting and reverse ordering with Undo.
- Optional text watermarks: **off by default**. Open Export options near the download button, enable the checkbox and enter your own text (English or Chinese). The light diagonal overlay is added on export only and also works for extracted/split PDFs. No automatic company watermark.
- No upload API, account, server-side PDF processing, analytics or advertising code.
- Human-written bilingual English / Simplified Chinese SEO pages: `/workspace/`, `/merge-pdf/`, `/split-pdf/`, `/organize-pdf/`, `/rotate-pdf/`, `/extract-pages/`, `/delete-pages/`, `/image-to-pdf/`, `/watermark-pdf/`, `/privacy/` plus `/zh/` counterparts. Hreflang and canonical tags provided.
- Three appearance modes: follow system, light, dark. Preference saved locally if the browser allows localStorage; all modes are CSS token-based.

### Duplicate and blank page limits

The 600-page workspace ceiling includes duplicated and generated blank pages. Duplicate creates new page references, not reimports of the original file; page rotation/order may be edited independently. Synthetic blank-page PDFs are kept in browser RAM, count toward page and memory budgets but not the 20 **imported-file** limit. Each blank page is sized to its visible neighbor, including an existing 90/270° rotation; it is not a new user-uploaded document. Current PDF forms, signatures, annotations and bookmarks may not be preserved in the reorganized output: keep and review the original.

## Deployment cache safety

The PDF.js Worker lives at the stable path `/pdfjs/pdf.worker.min.mjs`, while Astro application chunks have versioned filenames. Nginx requires the Worker to be revalidated (`Cache-Control: no-cache`) on each navigation to prevent a stale Worker from becoming incompatible with the updated PDF.js client after an upgrade. Versioned JS/CSS assets continue to use short-lived normal caching. The Docker CI smoke test verifies the Worker MIME type and cache response headers.

On each successful production publish, the container exposes the exact commit SHA at `/.well-known/plainmile-release` with a revalidation-only cache policy. Deployment confirms that the public Cloudflare URL returns that SHA before running browser E2E; the public HTML is also checked for canonical/hreflang. These checks deliberately do not depend on editable H1 or marketing text. A failed check rolls back only the PDF container to the last recorded healthy release.

## Leaving an active browser-local document

Imported PDFs/photos and typed text are kept only in the current browser tab. When leaving with unexported work, normal same-tab links (including tools and language changes) open a localized confirmation offering **Keep editing** or **Leave without saving**. A completed full PDF export, text/PDF download, or explicit Clear releases the guard; subsequent changes reactivate it. Browser Reload/Back/Close use the standard `beforeunload` warning where supported; browsers may suppress these native prompts without prior user interaction and their warning text cannot be customized. The feature does not persist file contents in localStorage, IndexedDB, cookies, or any server.

## Workbench reset and exported PDF metadata

- **Clear requires confirmation:** The workspace's irreversible reset explicitly asks before removing imported files, page edits and Undo/Redo history. Cancel keeps the entire edited document and its settings intact; confirming also resets image-to-PDF settings to the original A4 portrait, 30 pt margin, full-image contain defaults (preventing previously chosen crop behavior from leaking into a new document). This is different from Delete selected pages, which remains Undo-able.
- **No automatic PDF branding in document properties:** Newly composed/merged/extracted/split PDFs, raster-compressed PDFs, and TXT/Markdown-to-PDF output do not insert `PlainMile PDF` as Title or Creator; newly authored PDFs disable the library's implicit Producer and creation/modification timestamps. The visible official-site attribution remains on the web page. This is **not a general PDF metadata-scrubbing service**: embedded XMP, page-level attachments, images, or other structures may retain metadata, so do not rely on it for sensitive redaction.

## Important safety and editing behavior

- **Unmodified PDF export:** Exporting a single unchanged source PDF (including a single split section covering all pages) downloads the original bytes, retaining its original bookmarks, form fields, signatures, annotations, attachments and document metadata. This is **not metadata sanitization**.
- **Modified exports:** Merging sources, changing page order or rotations, extracting/deleting pages, creating multiple split sections or adding a watermark creates a *new* PDF by copying pages. Interactive forms, chapter bookmarks, signed documents, embedded attachments and some annotations may be lost, or signatures invalidated. These operations are not certified archival or preservation workflows. Keep the original and compare important exports.
- **Image format compatibility:** BMP and static AVIF use the browser's built-in image decoder and are embedded as PNG pixels into the generated PDF. AVIF must be supported by the user's browser; malformed/unsupported files fail without replacing the existing workspace. Animated AVIF/WebP is rejected (we do not silently keep just frame 1). HEIC, TIFF, SVG and GIF are not claimed as supported. Header validation checks compressed image dimensions before decoding and the existing 36-megapixel guard still applies. Browser-specific color conversion and HDR tone mapping may affect AVIF appearance; verify visually for important images. Original source files stay untouched.
- **Image-to-PDF paper choices:** A4 / Letter / image-sized; portrait, landscape or auto for fixed paper, while image-sized always follows each image. Margins: 0/12/30/48 pt. The default remains A4 portrait, 30 pt, full image. Cover mode explicitly crops overflowing image edges to the printable area, not outside the page. Any layout changes to loaded photos must be applied before exporting; Undo and page order are preserved.
- **Mobile navigation:** Four top-level tool links stay visible and keyboard-accessible in a horizontally scrollable row on narrow screens; the header no longer hides them without replacement.
- **Image ordering:** Image-only workspaces offer natural numeric filename ordering (`photo2` before `photo10`) and reverse order; drag/individual move controls remain available. Neither automatic sort nor irreversible mutation occurs upon import.
- **Undo-safe settings:** Each photo source records the paper/orientation/margins/placement actually applied. Undo that revives a previously deleted image with an older page layout blocks export until the images are reflowed; a newer photo cannot silently mark older paper as applied.
- **Unexpected settings and long exports:** Switching to fit-to-image explicitly resets the previously selected destructive cover/crop mode, so switching back to A4 does not silently crop. Importing a new photo after removing earlier photos resets the active layout even if other PDF pages remain. For exports of 24+ pages, the UI reports progress and offers cooperative cancellation; a cancelled operation never triggers a partial download.
- **PDF compression has two explicit choices:** By default, PDF object-stream optimization does not rasterize pages, so selectable text stays selectable, but already-optimized files may not shrink and rewriting invalidates digital signatures. The opt-in JPEG image mode may shrink image-heavy PDFs but destroys searchable text, forms and hyperlinks. Both methods can affect other complex features; keep the original, preview the actual result, and download only when the *measured* size is smaller. Neither mode is bitwise lossless or secure redaction.

## Limits and known non-goals

- Workspace: up to 20 input files, 100 MiB per file, **200 MiB of retained document source bytes**, 600 pages. For each photo, retained bytes include **both the uploaded original** (for paper-setting reflow/Undo) **and the generated PDF**, rather than counting only the compressed upload. For PDF inputs, the stored PDF buffer is counted once. For generated blank pages, their source PDF is counted too. Import and Apply photo settings fail without changing the current workspace when this bound would be exceeded. Only visible/nearby page thumbnails are rendered. Large books can still require substantial device memory; smaller/mobile devices may fail earlier. Images must not exceed 36 megapixels.
- Import requires PDFs supported by `pdf-lib`; malformed, encrypted or password-protected PDFs are rejected. Some valid but unusual PDFs may be rejected.
- PDF form-field compatibility, annotations, complex digital signatures and metadata preservation are not guaranteed when pages are copied. **Review exported documents carefully.**
- Not a PDF to Word, OCR, secure redaction or cryptographic signature tool. Text-preserving compression rewrites PDF object streams (not bitwise lossless); the optional JPEG mode is lossy rasterization.
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

Dependency versions are pinned through the committed npm v3 `package-lock.json` (generated and validated with Node 22 inside Docker). The production Dockerfile and CI use `npm ci` and fail if the lock is missing or mismatched. This makes **npm dependencies** reproducible; it does not guarantee byte-for-byte identical images across changing Node/Nginx base image tags, platforms, or registries. Pin and review exact image digests where stronger supply-chain reproducibility is required.

## Production deployment on netcup

The user has already configured DNS for `pdf.plainmile.com` and an Nginx host on the existing netcup VPS. Preserve this configuration and the existing PlainMile/InfraOpsX services. The **only** expected reverse proxy target is `http://plainmile-pdf-tools:80` on the existing external Docker network named `edge`.

`compose.prod.yaml` defines an independent static Nginx container, no ports bound to the host and no volumes containing user files. The deployment uses `/opt/compose/pdf-tools/` on the VPS. Deployment workflow `.github/workflows/deploy.yml` runs after the GHCR Publish Image workflow successfully publishes the reviewed `main` commit, and checks the new container's health and HTTPS site.

### Compose directory layout and migration

On this VPS, all Docker Compose applications live under `/opt/compose/`. PDF Tools uses **`/opt/compose/pdf-tools/`** for `compose.prod.yaml` and its server-local `.env` (only the pinned `IMAGE_TAG`); this keeps it consistent with the other applications. Custom operational scripts, if any, belong under `/opt/data/scripts/`, **not** beside Compose configurations.

The next successful automated deployment moves the existing **`/opt/data/compose/pdf-tools/`** directory to `/opt/compose/pdf-tools/` **only if the destination does not already exist**. If the destination exists, deployment reuses it and deliberately leaves the old directory untouched for review; it never merges or deletes unknown files. After deployment, confirm the PDF Tools container is healthy and its Compose working-directory label is `/opt/compose/pdf-tools`. You may then manually inspect/remove any unused legacy directory. No document data or database needs to be moved.

The container name `plainmile-pdf-tools`, the existing `edge` Docker network and the shared Nginx reverse proxy stay unchanged. The directory move alone does not expose host ports or restart unrelated services.

### Configure GitHub Actions secrets (only if they are not already scoped to this repository)

- `DEPLOY_HOST` - netcup SSH hostname/IP
- `DEPLOY_USER` - SSH user with Docker + write access to `/opt/compose/pdf-tools/`
- `DEPLOY_PORT` - optional, defaults to 22
- `DEPLOY_SSH_KEY` - SSH private deployment key (secret; never commit)
- `DEPLOY_HOST_KEY` - verified, pinned SSH host **public key**, e.g. `ssh-ed25519 AAAA...` (without the hostname)

Do not copy or reveal secrets through this repository. Do not disable host-key verification. If the GHCR package is private, make it public or configure **read-only** GHCR authentication on the VPS in advance. The workflow does not transmit registry credentials.

### First-run verification

```sh
# Run on netcup VPS; no Node or npm installation needed.
cd /opt/compose/pdf-tools
sudo docker compose -f compose.prod.yaml ps
sudo docker inspect -f '{{.State.Health.Status}}' plainmile-pdf-tools
sudo docker network inspect edge --format '{{range .Containers}}{{println .Name}}{{end}}'
curl -fsSI https://pdf.plainmile.com/
curl -fsSI https://pdf.plainmile.com/workspace/
curl -fsSI https://pdf.plainmile.com/pdfjs/pdf.worker.min.mjs
```

If the GitHub Actions deployment cannot authenticate, it must not alter the shared Nginx or other services. The recovery/manual path is:

```sh
# On netcup VPS only, after the reviewed GHCR image exists:
sudo mkdir -p /opt/compose/pdf-tools
cd /opt/compose/pdf-tools
# Copy compose.prod.yaml here from the reviewed repository.
printf 'IMAGE_TAG=REVIEWED_MAIN_SHA\n' | sudo tee .env
sudo docker compose -f compose.prod.yaml pull
sudo docker compose -f compose.prod.yaml up -d
sudo docker inspect -f '{{.State.Health.Status}}' plainmile-pdf-tools
```

Only the `pdf-tools` service is created or updated. No database migrations, user documents, host ports, or new infrastructure are involved.

## Rollback

**Automatic, guarded image rollback:** At the start of each production deployment, GitHub Actions reads the SHA tag of the **currently running healthy** `plainmile-pdf-tools` container (only when its Compose working directory is `/opt/compose/pdf-tools`). If the image health check, public HTTPS check or complete public Playwright E2E fails after the new SHA is attempted, the workflow restores the previously healthy image SHA and verifies that the container becomes healthy again. The workflow still reports **failure** and retains the failed E2E diagnostics; rolling back does not mean the release passed. It never restarts the shared Edge Nginx, touches other Compose applications, or prunes Docker images.

The rollback is deliberately skipped on first installs, when the previous image has no recognized 40-character SHA or was unhealthy, or if the server's `.env` no longer points at the failed SHA (for example, an operator has deployed another version). This is an **image-version rollback**, not a rollback of arbitrary Compose configuration changes or external Cloudflare routing. If the old image is unavailable or rollback fails, inspect the failing workflow and recover manually. An application outage or test infrastructure failure can still occur; there is no zero-downtime or guaranteed recovery claim.

**Manual recovery:** With a previous reviewed GHCR image tag, change the server-local `IMAGE_TAG`, run `docker compose -f compose.prod.yaml up -d`, and verify `/healthz`. No user documents or persistent storage need to migrate.

## License

MIT License. See [LICENSE](LICENSE). Source: https://github.com/plainmile/pdf-tools.

## Required CI and public release gates

1. Every `feature/**` push, PR update, and `main` push triggers unit/build and browser E2E on the built production Docker image. CI uses per-branch concurrency to cancel obsolete runs and caps the runner duration.
2. Successful CI of the **exact main commit** triggers `Publish Image` to GHCR. CI failures must never trigger publication.
3. `Deploy PDF Tools to netcup` consumes the published SHA, copies Compose, deploys, and checks container health and public HTTPS.
4. **Inside the same deployment GitHub-hosted Runner**, a bounded public release suite checks all 36 EN/zh indexable SEO pages (canonical, hreflang, sitemap, JSON-LD, navigation) plus synthetic PDF merge/split, image ZIP, text conversion, local drag/drop, and 125-page last-batch mobile export. Actual downloaded PDF/ZIP/JPG/TXT bytes are verified over `https://pdf.plainmile.com` without real user uploads. A repeatable failure triggers the guarded rollback. Full Chromium/Firefox/WebKit functional and fault-injection E2E remains mandatory in PR/main Docker CI; the manual public QA workflow still supports running the full suite separately.
5. E2E Docker containers use `--rm` and explicit `if: always()` cleanup. GitHub-hosted Runners are discarded after the job. Diagnostics are kept only on failure, for one day. The separate public QA workflow is **manual-only** to avoid duplicate Runner jobs.

The repository is public; GitHub's **standard hosted Runners** are free for public repositories, but artifact/package storage can still be limited. No always-on QA Runner or daemon is configured on netcup.

## Workflow design references

Borrow the practical interaction patterns found in PDF24, iLovePDF and Smallpdf, without cloning their branding or page layout: surface relevant controls before converting; show the actual order and preview; preserve original files; clearly separate reversible page editing from lossy conversions; explain file/page safety limits beside the action; and offer optional follow-on tools after a successful result. All processing remains browser-local; there are no user accounts or uploads.

## V1 browser-local utility tools

- **PDF to PNG/JPG:** Render selected pages to images; multiple pages download as ZIP. Supports resolution and page-range controls.
- **PDF compression:** Default object-stream rewriting attempts size savings without rasterizing searchable text; opt-in *lossy JPEG page* recompression can save more on image-heavy PDFs but removes searchable text and may lose forms, links and annotations. Both rewrite the file and invalidate digital signatures. Show actual before/after bytes; larger or unchanged results are never downloadable. Keep the original.
- **PDF to TXT/Markdown:** Extract pre-existing selectable text using PDF.js. No OCR; visual row order on /Rotate 90/180/270 pages follows the displayed PDF viewport rather than unrotated coordinates. Complex multi-column/tables may still reorder or flatten. Markdown headings are heuristic. Empty pages and image-backed pages with only a few selectable characters (such as printed page numbers on scanned books) are flagged for review. Common **visible filled PDF text and dropdown form values** are appended with their field labels when PDF.js exposes those annotation values. Radio/checkbox states, signatures, hidden or unsupported form widgets may still be missing; forms always require explicit review before download. Suspected incomplete text is **not auto-downloaded**, but users can explicitly download after checking the original. A photo page can also trigger a scan-like warning; this heuristic does not guarantee completeness.
- **TXT/Markdown to PDF:** Simple local A4 output, limited Markdown syntax (headings/lists/quotes/code). Pages with only built-in-font characters keep **selectable PDF text**; pages requiring Unicode/CJK browser fonts are **image-only** (no search/copy on those pages). Mixed-language books can contain both page types. No remote resources or HTML execution.
- **Add page numbers:** Select starting number, first numbered PDF page, any of six positions, font size and a safe 12 / 24 / 40 pt edge inset. Preview the actual generated PDF's first numbered page, last page, or any individual page (including a cover) before downloading. Page navigation reuses the same PDF.js preview document and worker for that output; switching pages never needs to reopen or reparse the whole PDF. Invalid preview page input never triggers a PDF page read. Changing an option retains any older generated PDF and visibly marks that preview as using previous settings. Small pages reject an inset that would push numbers off-page; failed retries never destroy an undownloaded numbered PDF.
- **PDF to TXT/Markdown and page numbering:** PDF input up to **100 MiB and 1,000 pages**. Page counting uses PDF.js; extraction parses one page at a time and cleans up PDF.js page resources. Numbering uses pdf-lib and may need additional RAM for very large PDFs.
- **PDF to JPG/PNG:** PDFs up to 100 MiB/1,000 pages, but each browser export is limited to **60 selected pages**. A 500-page document can export `301-360`; export the next batch separately. Each canvas is capped at **12 megapixels**. The final ZIP is held in browser memory; use batches to control RAM.
- **PDF compression (both modes):** PDFs up to 100 MiB, **120 pages per document** per run. Image-based JPEG recompression may be memory-intensive and removes text/search/link functionality. Document structure rewriting avoids rasterization but can still change PDF compatibility; both are bounded and offer download only when the result is smaller.
- **TXT/Markdown import:** up to **5 MiB UTF-8**. Latin-only text can produce up to 1,000 PDF pages; Unicode/CJK image-based rendering is capped at 300 pages because it uses significantly more memory. The 5 MiB input ceiling does not guarantee every document will fit into the output page limit.
- **Memory note:** The retained-source limit does not measure temporary image canvases, PDF.js preview-worker copies, serialization or ZIP/export allocations. Those can use additional RAM; a 200 MiB budget is not a guarantee that a low-memory device can open every permitted combination of files.
- **Large-file diagnostics:** CI runs 360-page two-document grouping/reveal/collapse stress scenarios at desktop (1280 px) and narrow touch/mobile (390 px) widths. It checks that off-screen page canvases remain lazy and logs the Chromium JavaScript heap size from CDP. This JS-heap diagnostic excludes native rendering/GPU/worker memory and is not a claim of fixed peak RAM usage.
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
