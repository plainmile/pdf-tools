# PDF Tools Agent Instructions

- The product lives at `pdf.plainmile.com` and in a separate `plainmile/pdf-tools` repository. Never edit the existing paycheck site's code or CI as part of the PDF work.
- All PDF processing is in-browser; never upload, log, store or transmit files, filenames, extracted text, or generated PDF content.
- Self-hosted LAN users may open the site over HTTP on a private IP, where `crypto.randomUUID` is not exposed; use `getRandomValues` for temporary IDs as a fallback. Do not mistake HTTP compatibility for public-network security.
- The site is a bilingual English / Simplified Chinese, privacy-first Astro + React static app with no user account or server-side PDF service. Public URLs are `/` and `/zh/` with parallel routes. English and Chinese content must be human-readable, not browser auto-translation.
- Deploy via a Docker-built static site served by Nginx. No host-installed Node/npm. Keep the shared `edge` Docker network and preserve existing website routing.
- Use feature branches + PRs + CI. Never bypass main protection or merge while unit/build/E2E tests are failing.
- Verify actual exported PDF pages using pdf-lib in E2E after drag, rotation, deletion, selection and splitting. UI-only success indicators are insufficient.
- All indexable public pages must have unique localized titles/descriptions, canonical URLs, reciprocal hreflang `en`/`zh-CN`, meaningful prerendered content, internal links and inclusion in sitemap. The 404 page must return status 404 and be excluded from indexing.
- Keep limits on document count, file size, total pages and image pixel count. Passworded, malformed PDFs and browser resource exhaustion must fail safely with user-friendly messages.
- Never claim a document is securely redacted or digitally signed if it is only visually overlaid.
- Appearance must support follow-system, light, and dark, with restrained professional office-app styling and enough contrast; do not introduce AI-style landing-page gradients or meaningless decoration.
- Do not add OAuth, ad code, telemetry, remote fonts, third-party upload APIs or paid AI without explicit approval and privacy review.
- Production container must not bind ports 80 or 443 on the host. Domain and TLS changes require testing edge proxy config and preserving current routes.
- The remote repository and DNS/Nginx have been created by the user. Never present a branch/PR or published image as proof of a deployed and browser-tested production site.
- Long PDF exports need cooperative cancellation and visible page progress; aborted exports must never download partial files. Setting fit-to-image must clear any hidden crop/cover option, and image-page layout must be initialized from active images, not stale Undo-only sources. Show advanced PDF feature-loss warnings only when the active workspace contains an original PDF.

- Text watermarks must be opt-in and off by default, including after clearing the workspace. Never insert a branded watermark automatically. Treat them as visual marks, not redactions. All operations remain browser-local and must work for CJK text where system fonts are present.

## CI, release and resource budget

- Every update to a feature branch, every PR update and every main commit must pass unit/build and full Playwright E2E against the built production Docker image. Do not merge failed CI.
- Publish GHCR images **only after the matching main SHA's CI succeeds**; deployments remain pinned to a tested SHA. Never deploy by bypassing tests.
- After each successful netcup deployment, run the complete Playwright suite again against **https://pdf.plainmile.com** inside the SAME ephemeral GitHub-hosted deployment runner. Download actual exported PDFs and inspect them; route/health-only checks are insufficient.
- GitHub public standard hosted runners are ephemeral. Use `docker run --rm`, `if: always()` cleanup, finite job timeouts, concurrency to cancel superseded feature branch CI, and avoid duplicate public QA workflows. Retain screenshots/traces only when tests fail (one day).
- The manual Public Site Browser E2E workflow is for requested audits, not a second automatic runner job after deployment. Never leave a persistent VPS QA container or send customer files to CI; synthetic PDFs only.

## New browser-local conversion tools and open-source license

- MIT License: keep `LICENSE` and public GitHub link visible in the bilingual footer; do not add proprietary or incompatible assets.
- PDF to JPG/PNG must verify image signatures and page selection; multi-page exports are a ZIP. PDF compression uses optional rasterization and must show measured input/output bytes; do not claim lossless compression or download files that grow larger. Warn users about text, links, annotations, forms and signatures being rasterized/lost.
- PDF-to-TXT/Markdown extracts only existing selectable text, never claim OCR or precise original layout. Markdown heading conversion is heuristic. TXT/Markdown-to-PDF supports a limited Markdown subset; non-Latin scripts rendered using local browser fonts yield image-based, not searchable, PDF pages.
- Keep input/resource limits, no upload network calls, bilingual SEO routes and end-to-end checks of exported files for every new tool. E2E gate before each publish and public GitHub Runner E2E after each netcup deployment. Clean QA containers even on failure.

## Book-length PDF limits (2026-10)

- Avoid one arbitrary 25 MiB/50-page limit for all tools. Set and show mode-specific safeguards: PDF text extraction/numbering 100 MiB and 1,000 pages; PDF-to-images max 60 selected pages per export with page-range batching and 12 MP/canvas; lossy compression 120 pages; TXT/Markdown input 5 MiB with 1,000 output pages for Latin and 300 image-based output pages for CJK; workspace up to 100 MiB/file, 200 MiB total and 600 pages with lazy thumbnail rendering.
- These are *ceilings*, not performance guarantees. Favor per-page cleanup, explicit worker teardown, a visible progress indication, and clearly localized warnings. Keep generated ZIP size bounded.
- Unit and public Playwright E2E must verify a synthetic 320+ page PDF (text first+last, numbered PDF, late-page raster selection), boundary rejection, and old workspace PDF behavior. Never claim 500-page memory safety without testing a representative input. No customer data in CI.

## Human-first UI and technical SEO safeguards

- Prefer modest typography, crisp office-style surfaces, practical grouped tools and clear primary actions over gradients, fictional success metrics, stock illustrations or AI-marketing copy.
- The static HTML catalog must render all 16 genuine tools (four intuitive categories) even when JavaScript is unavailable. Search only filters the already-visible HTML; keep keyboard, mobile and bilingual labels usable.
- Page-specific useful answers must be true to current implementations, including page limits, rasterized/uncopyable Unicode PDF text and lossy PDF compression. Avoid overclaiming or duplicating generic copy.
- Keep SEO canonical and reciprocal EN/zh-CN hreflang, sitemap/robots, unique titles and descriptions, one H1 and accurate visible JSON-LD (WebSite, WebApplication, BreadcrumbList) in both languages. Do not add Review/FAQPage rich-result markup unless genuine eligibility and content permit it.
- Every feature or UI PR must pass unit, container-build and full Playwright E2E before merge; every production deploy runs actual public-site tests on the same Runner and cleans Docker resources. Don't add redundant scheduled QA workflows.

## Transparent origin credit in redistributed images

- The publicly distributed image must include a **visible and crawlable** bilingual footer link to `https://pdf.plainmile.com/` labeled Official site / 官方网站. Keep this useful to people and consistent across both locales and all static tool pages; use `rel="nofollow"` on the distributed template link to avoid a mass-produced backlink scheme. No cloaking, hidden links, anchor keyword stuffing, review manipulation or guaranteed SEO-benefit claims.
- The original website remains the canonical source of the shipped static content. Self-hosts seeking independent indexability should rebuild with their actual origin/canonical/hreflang/schema settings rather than blindly duplicating official URLs. The site is MIT-licensed; this on-page origin link is default attribution, **not an additional legal licensing condition**.
- Verify footer origin attribution on every real public URL through the post-deploy Runner E2E, plus a JS-disabled pre-merge check of representative English/Chinese pages; never skip functional E2E.

## File entry and repeatable image batches

- All standalone utility converters support **both native file picker and drag/drop** with a clearly visible no-upload message; neither may issue a POST to process document contents. Preserve native keyboard/screen-reader file picker access.
- When a long PDF has more than 60 pages, pre-select a safe 60-page image batch rather than defaulting to all pages and failing. Provide bilingual previous/next batch controls and distinguish ZIP filenames by selected range. Keep arbitrary page ranges available.
- Verify the resulting images and ZIP, not just navigation: the post-deploy public Runner must cover drag/drop PDF/TXT, mobile 375px batch navigation and image extraction from the last pages of a long synthetic document. Never loosen PDF raster memory caps merely for convenience.
