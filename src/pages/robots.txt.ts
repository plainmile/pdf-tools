export const prerender = true;
export function GET() {
  return new Response('User-agent: *\nAllow: /\nSitemap: https://pdf.plainmile.com/sitemap-index.xml\n', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
