const amountInput = document.querySelector('#calc-amount');
const error = document.querySelector('#calc-error');
const outputs = ['base', 'fee', 'merchant', 'total'].map((name) => document.querySelector(`#calc-${name}`));

function money(value) {
  const whole = value / 1000000n, fraction = (value % 1000000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${whole.toLocaleString('en-US')}.${fraction ? fraction.padEnd(2, '0') : '00'} test tokens`;
}
function update() {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,6}))?$/.exec(amountInput.value.trim());
  if (!match || match[1].length > 30) {
    error.textContent = 'Enter an amount with up to six decimal places.';
    outputs.forEach((output) => { output.textContent = '—'; }); return;
  }
  const amount = BigInt(match[1]) * 1000000n + BigInt((match[2] || '').padEnd(6, '0'));
  if (amount === 0n) { error.textContent = 'Enter an amount greater than zero.'; outputs.forEach((output) => { output.textContent = '—'; }); return; }
  error.textContent = '';
  const fee = (amount * 30n + 5000n) / 10000n;
  const customerPays = document.querySelector('input[name="payer"]:checked').value === 'customer';
  [amount, fee, customerPays ? amount : amount - fee, customerPays ? amount + fee : amount].forEach((value, i) => { outputs[i].textContent = money(value); });
}
amountInput.addEventListener('input', update);
document.querySelectorAll('input[name="payer"]').forEach((input) => input.addEventListener('change', update));
update();
