import { describe, it, expect } from 'vitest';
import { parseAreas, findArea, lineLabel, DEFAULT_AREA } from '../server/areas.js';

describe('parseAreas', () => {
  it('defaults to CMP 4, GFF 2, and one line each for RTE and Pack Off', () => {
    expect(parseAreas({})).toEqual([
      { key: 'cmp', label: 'CMP', lines: 4 },
      { key: 'gff', label: 'GFF', lines: 2 },
      { key: 'rte', label: 'RTE', lines: 1 },
      { key: 'packoff', label: 'Pack Off', lines: 1 },
    ]);
  });

  it('reads each area\'s line count from its own env var', () => {
    const areas = parseAreas({
      SNAPBOX_CMP_LINES: '6',
      SNAPBOX_GFF_LINES: '3',
      SNAPBOX_RTE_LINES: '2',
      SNAPBOX_PACKOFF_LINES: '2',
    });
    expect(areas.map((a) => a.lines)).toEqual([6, 3, 2, 2]);
  });

  it('still honours the pre-areas SNAPBOX_TABLES as the CMP line count', () => {
    const areas = parseAreas({ SNAPBOX_TABLES: '5' });
    expect(findArea(areas, 'cmp').lines).toBe(5);
    expect(findArea(areas, 'gff').lines).toBe(2); // untouched
    expect(findArea(areas, 'rte').lines).toBe(1); // untouched
    expect(findArea(areas, 'packoff').lines).toBe(1); // untouched
  });

  it('prefers the area-specific var over the legacy one', () => {
    const areas = parseAreas({ SNAPBOX_TABLES: '5', SNAPBOX_CMP_LINES: '8' });
    expect(findArea(areas, 'cmp').lines).toBe(8);
  });

  it('falls back to the default count for junk and non-positive values', () => {
    for (const bad of ['nope', '0', '-2', '2.5', '']) {
      expect(findArea(parseAreas({ SNAPBOX_GFF_LINES: bad }), 'gff').lines).toBe(2);
    }
  });
});

describe('findArea', () => {
  const areas = parseAreas({});

  it('is case- and space-insensitive', () => {
    expect(findArea(areas, 'GFF').key).toBe('gff');
    expect(findArea(areas, ' gff ').key).toBe('gff');
    expect(findArea(areas, 'PackOff').key).toBe('packoff');
  });

  it('returns undefined for an area that does not exist', () => {
    for (const bad of ['xyz', '', null, undefined]) expect(findArea(areas, bad)).toBeUndefined();
  });

  it('CMP is the default area, so pre-areas posts stay CMP', () => {
    expect(DEFAULT_AREA).toBe('cmp');
    expect(findArea(areas, DEFAULT_AREA)).toBeDefined();
  });
});

describe('lineLabel', () => {
  const areas = parseAreas({});

  it('names a line by its area', () => {
    expect(lineLabel(areas, 'cmp', 2)).toBe('CMP Line 2');
    expect(lineLabel(areas, 'gff', 1)).toBe('GFF Line 1');
    expect(lineLabel(areas, 'rte', 1)).toBe('RTE Line 1');
    expect(lineLabel(areas, 'packoff', 1)).toBe('Pack Off Line 1');
  });

  it('falls back to the raw key for an unknown area', () => {
    expect(lineLabel(areas, 'zzz', 1)).toBe('ZZZ Line 1');
  });
});
