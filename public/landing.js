// Role picker: Warehouse Tablet (assign to a line) or Manager Hub.
const choiceGrid = document.getElementById('choiceGrid');
const linePick = document.getElementById('linePick');
const lineGrid = document.getElementById('lineGrid');

document.getElementById('chooseManager').addEventListener('click', () => {
  location.href = '/hub';
});

document.getElementById('chooseTablet').addEventListener('click', async () => {
  let count = 4;
  try {
    const cfg = await (await fetch('/api/config')).json();
    count = cfg.tableCount || 4;
  } catch {
    /* use default */
  }
  lineGrid.innerHTML = '';
  for (let i = 1; i <= count; i++) {
    const b = document.createElement('button');
    b.className = 'line-btn';
    b.textContent = i;
    b.addEventListener('click', () => (location.href = `/table/${i}`));
    lineGrid.appendChild(b);
  }
  choiceGrid.hidden = true;
  linePick.hidden = false;
});

document.getElementById('backBtn').addEventListener('click', () => {
  linePick.hidden = true;
  choiceGrid.hidden = false;
});
