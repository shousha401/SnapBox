// SnapBox covers four production areas — CMP, GFF, RTE and Pack Off — each with
// its own lines.
// A post belongs to an (area, line) pair, and `area` is what keeps GFF Line 1
// apart from CMP Line 1 everywhere: the hub columns, each tablet's own feed, the
// SSE targeting, and the history filters.
//
// Posts created before areas existed have no area of their own, so the column
// defaults to 'cmp' — that deployment's lines were all CMP lines.

export const DEFAULT_AREA = 'cmp';

// SNAPBOX_TABLES is the pre-areas name for the CMP line count; still honoured so
// an existing deployment keeps its line count without touching the env.
const DEFS = [
  { key: 'cmp', label: 'CMP', lines: 4, env: 'SNAPBOX_CMP_LINES', legacyEnv: 'SNAPBOX_TABLES' },
  { key: 'gff', label: 'GFF', lines: 2, env: 'SNAPBOX_GFF_LINES' },
  { key: 'rte', label: 'RTE', lines: 4, env: 'SNAPBOX_RTE_LINES' },
  { key: 'packoff', label: 'Pack Off', lines: 4, env: 'SNAPBOX_PACKOFF_LINES' },
];

/** Areas with their line counts, read from the environment. */
export function parseAreas(env = {}) {
  return DEFS.map((d) => {
    const raw = env[d.env] ?? (d.legacyEnv ? env[d.legacyEnv] : undefined);
    const n = Number(raw);
    return {
      key: d.key,
      label: d.label,
      lines: Number.isInteger(n) && n > 0 ? n : d.lines,
    };
  });
}

export const defaultAreas = () => parseAreas({});

/** Look an area up by key. Returns undefined for anything unknown. */
export function findArea(areas, key) {
  const k = String(key ?? '').trim().toLowerCase();
  return areas.find((a) => a.key === k);
}

/** "CMP Line 2" — the human name of a line, for filenames and headings. */
export function lineLabel(areas, key, lineNo) {
  const a = findArea(areas, key);
  return `${a ? a.label : String(key).toUpperCase()} Line ${lineNo}`;
}
