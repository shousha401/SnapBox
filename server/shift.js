// Shift logic — a "shift" is just a label we filter the hub feed by.
// Nothing is ever deleted on a shift boundary; the board just shows the
// current shift_id. Default is one shift per day (shift_id === the date).

/** Parse "HH:MM,HH:MM" into sorted minutes-from-midnight. Empty -> [0] (single daily shift). */
export function parseShifts(str) {
  if (!str) return [0];
  const mins = String(str)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((hhmm) => {
      const [h, m] = hhmm.split(':').map(Number);
      return (h || 0) * 60 + (m || 0);
    })
    .filter((n) => Number.isFinite(n) && n >= 0 && n < 24 * 60);
  return mins.length ? [...new Set(mins)].sort((a, b) => a - b) : [0];
}

function dateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Compute the shift_id for a given Date.
 * @param {Date} date
 * @param {number[]} startsMinutes sorted minutes-from-midnight of each shift start
 * @returns {string} e.g. "2026-07-13" (single shift) or "2026-07-13#1" (multi-shift)
 */
export function shiftIdFor(date, startsMinutes = [0]) {
  const starts = [...startsMinutes].sort((a, b) => a - b);
  const mins = date.getHours() * 60 + date.getMinutes();

  // Time before the first start belongs to the previous day's last shift.
  if (mins < starts[0]) {
    const prev = new Date(date);
    prev.setDate(prev.getDate() - 1);
    return starts.length === 1 ? dateStr(prev) : `${dateStr(prev)}#${starts.length - 1}`;
  }

  let idx = 0;
  for (let i = 0; i < starts.length; i++) {
    if (mins >= starts[i]) idx = i;
  }
  return starts.length === 1 ? dateStr(date) : `${dateStr(date)}#${idx}`;
}
