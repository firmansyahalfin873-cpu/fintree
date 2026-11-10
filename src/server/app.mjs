import { createOnboardingHandler } from '../api/onboarding-handler.mjs';
import { createCheckoutHandler } from '../api/checkout-handler.mjs';
import { createPublicCheckoutHandler } from '../api/public-checkout-handler.mjs';
import { createWebhookSettingsHandler } from '../api/webhook-settings-handler.mjs';
import { createMerchantHandler } from '../api/merchant-handler.mjs';
import { createApiKeysHandler } from '../api/api-keys-handler.mjs';

/** Compose server-only dependencies into the testnet HTTP application. */
export function createApp({ db, signer, config, origin, assets, webhookSettings, runtimeStatus }) {
  const onboarding = createOnboardingHandler({ db, origin });
  const merchantCheckout = createCheckoutHandler({ db, signer, config, checkoutOrigin: origin });
  const publicCheckout = createPublicCheckoutHandler({ db });
  const webhook = createWebhookSettingsHandler({ db, settings: webhookSettings });
  const merchant = createMerchantHandler({ db });
  const apiKeys = createApiKeysHandler({ db });
  return async (request) => {
    const path = new URL(request.url).pathname;
    if (assets && request.method === 'GET') {
      const page = path === '/dashboard' || /^\/pay\/0x[0-9a-f]{64}$/i.test(path);
      const selected = path === '/' ? [assets.landingHtml, 'text/html; charset=utf-8'] : page ? [assets.html, 'text/html; charset=utf-8'] : path === '/landing.css' ? [assets.landingCss, 'text/css; charset=utf-8'] : path === '/styles.css' ? [assets.css, 'text/css; charset=utf-8'] : path === '/testnet.css' ? [assets.testnetCss, 'text/css; charset=utf-8'] : path === '/testnet.js' ? [assets.javascript, 'text/javascript; charset=utf-8'] : null;
      if (path === '/payment-flow-art.png') return new Response(assets.landingArt, { headers: { 'content-type': 'image/png', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
      if (path === '/landing.js') return new Response(assets.landingJs, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
      if (path === '/developers') return new Response(assets.developersHtml, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'", 'x-content-type-options': 'nosniff' } });
      if (path === '/developers.js') return new Response(assets.developersJs, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
      if (path === '/site-nav.js') return new Response(assets.siteNavJs, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
      if (path === '/workspace-nav.js') return new Response(assets.workspaceNavJs, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
      if (path === '/help') return new Response(assets.helpHtml, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'", 'x-content-type-options': 'nosniff' } });
      if (path === '/help.js') return new Response(assets.helpJs, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
      if (path === '/pricing') return new Response(assets.pricingHtml, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'", 'x-content-type-options': 'nosniff' } });
      if (path === '/security') return new Response(assets.securityHtml, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'", 'x-content-type-options': 'nosniff' } });
      if (path === '/pricing.js') return new Response(assets.pricingJs, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
      if (selected) return new Response(selected[0], { headers: { 'content-type': selected[1], 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" } });
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.has('origin') && request.headers.get('origin') !== origin) return Response.json({ error: 'invalid_origin' }, { status: 403 });
    if (path.startsWith('/api/v1/wallet/')) return onboarding(request);
    if (path === '/api/v1/merchant') return merchant(request);
    if (path === '/api/v1/api-keys' || path.startsWith('/api/v1/api-keys/')) return apiKeys(request);
    if (path === '/api/v1/checkout/sessions' || path.startsWith('/api/v1/checkout/sessions/')) return merchantCheckout(request);
    if (path === '/api/v1/webhook' || path.startsWith('/api/v1/webhook/')) return webhook(request);
    if (path.startsWith('/api/v1/public/checkout/')) return publicCheckout(request);
    if (path === '/api/v1/public/service-status' && request.method === 'GET') return Response.json(runtimeStatus ? runtimeStatus.snapshot() : { scanner: { state: 'unavailable' }, webhook: { state: 'unavailable' } }, { headers: { 'cache-control': 'no-store' } });
    if (path === '/api/v1/public/config' && request.method === 'GET') return Response.json({ chainId: config.chainId.toString(), contract: config.contract, token: config.token, signer: config.signerAddress, tokenDecimals: config.tokenDecimals }, { headers: { 'cache-control': 'no-store' } });
    return Response.json({ error: 'not_found' }, { status: 404, headers: { 'cache-control': 'no-store' } });
  };
}
