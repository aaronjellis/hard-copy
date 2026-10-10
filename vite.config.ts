import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

/**
 * SEO tags that need an absolute URL. Lines in index.html containing %VITE_SITE_URL% are filled
 * with the site URL, or removed when it is empty. At build, also emits robots.txt and sitemap.xml.
 */
function siteUrl(): Plugin {
  let url = '';
  return {
    name: 'hard-copy-site-url',
    configResolved(config) {
      url = String(config.env.VITE_SITE_URL ?? '').trim();
      if (url && !url.endsWith('/')) url += '/';
    },
    transformIndexHtml: {
      order: 'pre',
      handler: (html) =>
        url
          ? html.replaceAll('%VITE_SITE_URL%', url)
          : html.split('\n').filter((line) => !line.includes('%VITE_SITE_URL%')).join('\n'),
    },
    generateBundle() {
      const robots = `User-agent: *\nAllow: /\n${url ? `\nSitemap: ${url}sitemap.xml\n` : ''}`;
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots });
      if (!url) return;
      const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${url}</loc></url>\n</urlset>\n`;
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [svelte(), siteUrl()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
