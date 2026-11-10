import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

/** Bundle only the browser entry; private server keys and environment stay server-side. */
export async function loadTestnetAssets() {
  const [html, css, testnetCss, landingHtml, landingCss, landingArt, landingJs, developersHtml, developersJs, pricingHtml, pricingJs, securityHtml, siteNavJs, helpHtml, helpJs, workspaceNavJs, bundled] = await Promise.all([
    fs.readFile(new URL('../../public/testnet.html', import.meta.url)),
    fs.readFile(new URL('../../public/styles.css', import.meta.url)),
    fs.readFile(new URL('../../public/testnet.css', import.meta.url)),
    fs.readFile(new URL('../../public/landing.html', import.meta.url)),
    fs.readFile(new URL('../../public/landing.css', import.meta.url)),
    fs.readFile(new URL('../../public/payment-flow-art.png', import.meta.url)),
    fs.readFile(new URL('../../public/landing.js', import.meta.url)),
    fs.readFile(new URL('../../public/developers.html', import.meta.url)),
    fs.readFile(new URL('../../public/developers.js', import.meta.url)),
    fs.readFile(new URL('../../public/pricing.html', import.meta.url)),
    fs.readFile(new URL('../../public/pricing.js', import.meta.url)),
    fs.readFile(new URL('../../public/security.html', import.meta.url)),
    fs.readFile(new URL('../../public/site-nav.js', import.meta.url)),
    fs.readFile(new URL('../../public/help.html', import.meta.url)),
    fs.readFile(new URL('../../public/help.js', import.meta.url)),
    fs.readFile(new URL('../../public/workspace-nav.js', import.meta.url)),
    build({ entryPoints: [fileURLToPath(new URL('../../public/testnet.js', import.meta.url))], bundle: true, platform: 'browser', format: 'esm', write: false, target: 'es2022', minify: true, logLevel: 'silent' }),
  ]);
  return { html, css, testnetCss, landingHtml, landingCss, landingArt, landingJs, developersHtml, developersJs, pricingHtml, pricingJs, securityHtml, siteNavJs, helpHtml, helpJs, workspaceNavJs, javascript: bundled.outputFiles[0].contents };
}
