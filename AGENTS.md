# PDF Tools Agent Instructions

- The product lives at `pdf.plainmile.com` and in a separate `plainmile/pdf-tools` repository. Never edit the existing paycheck site's code or CI as part of the PDF work.
- All PDF processing is in-browser; never upload, log, store or transmit files, filenames, extracted text, or generated PDF content.
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
