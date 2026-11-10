// The workspace uses deep-linkable sections; customer checkout is a separate view.
if (location.pathname === '/dashboard' || location.pathname === '/') {
  const testnet = document.body.classList.contains('testnet-app');
  const mapping = testnet ? {
    '#overview': 'overview', '#create': 'create', '#payments': 'payments',
    '#profile': 'profile', '#webhooks': 'webhooks', '#keys': 'keys',
  } : { '#create': 'create', '#payments': 'payments' };
  const legacy = testnet ? {
    '#merchant': '#overview', '#invoice-form': '#create', '#payment-activity': '#payments',
    '#merchant-settings': '#profile', '#webhook-settings': '#webhooks', '#api-keys': '#keys',
  } : { '#new-payment': '#create', '#activity': '#payments' };
  if (legacy[location.hash]) history.replaceState(null, '', `${location.pathname}${location.search}${legacy[location.hash]}`);
  const labels = {
    overview: ['Build your payment flow.', 'Connect your wallet, create a test payment, and track its status.'],
    create: ['Create a payment.', 'Enter the details and share the checkout link.'],
    payments: ['Your payments.', 'Review, search and manage the payments loaded in your workspace.'],
    profile: ['Business profile.', 'Manage the name shown to customers at checkout.'],
    webhooks: ['Payment notifications.', 'Manage your endpoint and review delivery history.'],
    keys: ['API keys.', 'Create and manage keys for your integration.'],
  };
  const $ = (selector) => document.querySelector(selector);
  const show = (selector, visible) => { const element = $(selector); if (element) element.hidden = !visible; };

  function render() {
    const view = mapping[location.hash] || 'overview';
    document.body.dataset.workspaceView = view;
    if (testnet) {
      const [title, subtitle] = labels[view];
      $('#workspace-title').textContent = title; $('#workspace-subtitle').textContent = subtitle;
      show('.testnet-heading-action', view === 'overview' || view === 'payments');
      show('.getting-started', view === 'overview');
      show('.testnet-intro-grid', view === 'overview' || view === 'create');
      show('.service-card', view === 'overview');
      show('.payment-summary', view === 'overview' || view === 'payments');
      show('.testnet-work-grid', ['overview', 'create', 'payments'].includes(view));
      show('.create-card', view === 'overview' || view === 'create');
      show('#payment-activity', view === 'overview' || view === 'payments');
      show('.testnet-section-heading', false);
      const groups = document.querySelectorAll('.testnet-settings-grid');
      groups[0].hidden = !['profile', 'webhooks'].includes(view);
      groups[1].hidden = !['keys', 'webhooks'].includes(view);
      show('#merchant-settings', view === 'profile'); show('#webhook-settings', view === 'webhooks');
      show('#api-keys', view === 'keys'); show('#webhook-history', view === 'webhooks');
      const keySlot = view === 'keys' ? $('#managed-key-slot') : $('#wallet-key-slot');
      const keyArea = $('#key-area');
      if (keySlot && keyArea && keyArea.parentElement !== keySlot) keySlot.append(keyArea);
      show('#workspace-connect-reminder', !['overview', 'create'].includes(view) && $('#disconnect-area').hidden);
    } else {
      const title = $('.workspace-heading h1'), subtitle = $('.workspace-heading p:not(.overline)');
      const simulationLabels = { overview: ['Payments, in perspective.', 'Create and track test payments in one place.'], create: ['Create a payment.', 'Enter the details to create a checkout.'], payments: ['Your payments.', 'Search and review payments in this session.'] };
      [title.textContent, subtitle.textContent] = simulationLabels[view];
      show('.heading-action', view !== 'create');
      show('.metric-grid', view === 'overview' || view === 'payments');
      show('#new-payment', view === 'overview' || view === 'create');
      show('#activity', view === 'overview' || view === 'payments');
      show('.next-steps', view === 'overview');
    }
    for (const link of document.querySelectorAll(testnet ? '.testnet-side-nav a' : '.side-nav a')) {
      const href = new URL(link.href, location.href);
      const selected = href.pathname === '/dashboard' && ((mapping[href.hash] || 'overview') === view) && (href.hash || view === 'overview');
      if (selected) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    }
  }
  render();
  const scrollToTop = () => window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  if (mapping[location.hash]) window.addEventListener('load', scrollToTop, { once: true });
  window.addEventListener('hashchange', () => {
    if (location.hash === '#wallet-setup') { document.querySelector('#wallet-setup')?.scrollIntoView(); return; }
    if (legacy[location.hash]) history.replaceState(null, '', `${location.pathname}${location.search}${legacy[location.hash]}`);
    render(); scrollToTop();
  });
  if (testnet) {
    new MutationObserver(render).observe($('#disconnect-area'), { attributes: true, attributeFilter: ['hidden'] });
  }
}
