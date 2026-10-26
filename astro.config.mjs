// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://pdf.plainmile.com',
  output: 'static',
  integrations: [react(), sitemap({
    // Astro may expose the 404 route as /404, /404/ or /404.html depending on
    // the output path. None are indexable; reject all three from the sitemap.
    filter: (url) => !/\/404(?:\/|\.html)?$/.test(new URL(url).pathname),
  })],
  vite: {
    optimizeDeps: { exclude: ['pdfjs-dist'] },
  },
});
