// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://pdf.plainmile.com',
  output: 'static',
  integrations: [react(), sitemap({ filter: (url) => !/\/404\/?$/.test(new URL(url).pathname) })],
  vite: {
    optimizeDeps: { exclude: ['pdfjs-dist'] },
  },
});
