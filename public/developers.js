for (const button of document.querySelectorAll('[data-copy-target]')) {
  button.addEventListener('click', async () => {
    const id = button.getAttribute('data-copy-target');
    const code = document.getElementById(id), state = document.getElementById(`${id}-copy-state`);
    if (!code || !state) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(code.textContent);
      state.textContent = 'Code copied.';
    } catch { state.textContent = 'Could not copy automatically. Select the code and copy it manually.'; }
  });
}
