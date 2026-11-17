import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vite';

function normalizeBasePath(raw?: string): string {
  if (!raw || raw.trim() === '' || raw.trim() === '/') {
    return '/';
  }
  const trimmed = raw.trim().replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}/` : '/';
}

function normalizeSiteOrigin(raw?: string): string {
  if (!raw) return '';
  return raw.trim().replace(/\/+$/, '');
}

export default defineConfig(() => {
  const base = normalizeBasePath(process.env.VITE_BASE_PATH);
  const siteOrigin = normalizeSiteOrigin(process.env.VITE_PUBLIC_SITE_URL || process.env.APP_URL);

  return {
    base,
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'multicraft-seo-and-static-assets',
        transformIndexHtml(html) {
          let updated = html.replace(/href="\/favicon\.svg"/g, `href="${base}favicon.svg"`);
          if (!siteOrigin) {
            return updated;
          }
          const absoluteCover = `${siteOrigin}/og-cover.jpg`;
          const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          updated = updated
            .replace(new RegExp(`content="(?:${escapedBase}|\\/)og-cover\\.jpg"`, 'g'), `content="${absoluteCover}"`)
            .replace(new RegExp(`href="(?:${escapedBase}|\\/)llms\\.txt"`, 'g'), `href="${siteOrigin}/llms.txt"`);
          if (!updated.includes('rel="canonical"')) {
            updated = updated.replace(
              '</head>',
              `    <link rel="canonical" href="${siteOrigin}/" />\n    <meta property="og:url" content="${siteOrigin}/" />\n  </head>`
            );
          }
          return updated;
        },
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const rootDir = import.meta.dirname;
          const distDir = path.resolve(rootDir, 'dist');
          const srcAssets = path.resolve(rootDir, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, { recursive: true, force: true });
          }

          if (fs.existsSync(distDir)) {
            const seoFiles = ['robots.txt', 'sitemap.xml', 'llms.txt', 'llms-full.txt'];
            for (const file of seoFiles) {
              const filePath = path.join(distDir, file);
              if (fs.existsSync(filePath)) {
                const raw = fs.readFileSync(filePath, 'utf-8');
                const replaced = raw.replace(/__SITE_ORIGIN__/g, siteOrigin || '');
                fs.writeFileSync(filePath, replaced, 'utf-8');
              }
            }

            // Copy index.html to 404.html for GitHub Pages SPA route fallback
            const indexHtml = path.join(distDir, 'index.html');
            const notFoundHtml = path.join(distDir, '404.html');
            if (fs.existsSync(indexHtml)) {
              fs.copyFileSync(indexHtml, notFoundHtml);
            }
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
