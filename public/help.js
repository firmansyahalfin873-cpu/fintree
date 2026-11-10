const search = document.querySelector('#help-search');
const clear = document.querySelector('#help-clear');
const status = document.querySelector('#help-search-state');
const empty = document.querySelector('#help-no-results');
const topics = [...document.querySelectorAll('.help-qa')];

function update() {
  const words = search.value.trim().toLocaleLowerCase('en-US').split(/\s+/).filter(Boolean);
  let count = 0;
  for (const topic of topics) {
    const text = topic.textContent.toLocaleLowerCase('en-US');
    const matches = words.every((word) => text.includes(word));
    topic.hidden = !matches;
    if (!matches) topic.open = false;
    else count++;
  }
  clear.hidden = words.length === 0;
  empty.hidden = count !== 0;
  status.textContent = words.length ? `${count} matching topic${count === 1 ? '' : 's'}.` : 'Showing all help topics.';
}
search.addEventListener('input', update);
clear.addEventListener('click', () => { search.value = ''; update(); search.focus(); });
