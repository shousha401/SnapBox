// Role picker: a tablet on a CMP line, a tablet on a GFF line, or the Manager
// Hub (which sees both areas).
const choiceGrid = document.getElementById('choiceGrid');
const linePick = document.getElementById('linePick');
const linePickTitle = document.getElementById('linePickTitle');
const lineGrid = document.getElementById('lineGrid');

const FALLBACK_AREAS = [
  { key: 'cmp', label: 'CMP', lines: 4 },
  { key: 'gff', label: 'GFF', lines: 2 },
  { key: 'rte', label: 'RTE', lines: 4 },
  { key: 'packoff', label: 'Pack Off', lines: 4 },
];

let areasPromise = null;
function getAreas() {
  if (!areasPromise) {
    areasPromise = fetch('/api/config')
      .then((r) => r.json())
      .then((cfg) => (cfg.areas && cfg.areas.length ? cfg.areas : FALLBACK_AREAS))
      .catch(() => FALLBACK_AREAS);
  }
  return areasPromise;
}

document.getElementById('chooseManager').addEventListener('click', () => {
  location.href = '/hub';
});

for (const card of document.querySelectorAll('.choice-card[data-area]')) {
  card.addEventListener('click', async () => {
    const key = card.dataset.area;
    const areas = await getAreas();
    const area = areas.find((a) => a.key === key) || { key, label: key.toUpperCase(), lines: 4 };

    // An area with a single line has nothing to pick — go straight in.
    if (area.lines === 1) {
      location.href = `/line/${area.key}/1`;
      return;
    }

    linePickTitle.textContent = `Which ${area.label} line are you on?`;
    lineGrid.innerHTML = '';
    for (let i = 1; i <= area.lines; i++) {
      const b = document.createElement('button');
      b.className = 'line-btn';
      b.textContent = i;
      b.addEventListener('click', () => (location.href = `/line/${area.key}/${i}`));
      lineGrid.appendChild(b);
    }
    choiceGrid.hidden = true;
    linePick.hidden = false;
  });
}

document.getElementById('backBtn').addEventListener('click', () => {
  linePick.hidden = true;
  choiceGrid.hidden = false;
});
