/**
 * G4.53 — the descriptor field reference (`docs/design/plugin-contract.md`) and
 * `BlockKindDescriptor` are one set, both directions. The registration shape freezes at 1.0, so a
 * field landing undocumented and a row outliving its field are the two ways the published
 * inventory stops being the inventory. Keyed on the field-name column alone, so the prose columns
 * stay free to be rewritten.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DESCRIPTOR_FIELDS, CONTAINER_ONLY_KEYS } from '$lib/schema/block-kind-descriptor';

const SECTION_HEADING = '### The descriptor field reference';

// ── Doc parsing ──────────────────────────────────────────────────────────────

/** The reference section's text, ending at the next heading of any depth. */
export function fieldReferenceSection(markdown: string): string {
	const body = markdown.split(SECTION_HEADING)[1];
	return body === undefined ? '' : body.split(/\n#{1,6} /)[0];
}

/** Each row's field name: the first cell's single backticked token. Header and rule dropped. */
export function parseFieldRows(section: string): string[] {
	const names: string[] = [];
	for (const line of section.split('\n')) {
		if (!line.trimStart().startsWith('|')) continue;
		const first = (line.split('|')[1] ?? '').trim();
		const match = first.match(/^`([A-Za-z][A-Za-z0-9]*)`$/);
		if (match) names.push(match[1]);
	}
	return names;
}

const doc = readFileSync(path.resolve('docs/design/plugin-contract.md'), 'utf8');
const documented = parseFieldRows(fieldReferenceSection(doc));

// ── The gate ─────────────────────────────────────────────────────────────────

describe('G4.53 descriptor field reference ↔ BlockKindDescriptor', () => {
	it('documents every descriptor field', () => {
		const undocumented = DESCRIPTOR_FIELDS.filter((field) => !documented.includes(field));
		expect(
			undocumented,
			`these descriptor fields have no row in ${SECTION_HEADING} — add one carrying its tier, what omitting it means, and what it declares: ${undocumented.join(', ')}`
		).toEqual([]);
	});

	it('holds no row for a field the type dropped', () => {
		const live = new Set<string>(DESCRIPTOR_FIELDS);
		const stale = documented.filter((field) => !live.has(field));
		expect(stale, `stale field reference rows: ${stale.join(', ')}`).toEqual([]);
	});

	it('lists each field once', () => {
		const duplicated = documented.filter((field, i) => documented.indexOf(field) !== i);
		expect(duplicated, `duplicated rows: ${duplicated.join(', ')}`).toEqual([]);
	});

	// The write-side group normalizes into the flat read shape, so its keys are covered by the flat
	// rows — but only while every group key still names one. `contract` is the lone rename.
	it('covers the container group through its flat twins', () => {
		const missing = CONTAINER_ONLY_KEYS.filter((key) => !documented.includes(key));
		expect(missing, `container-group fields with no row: ${missing.join(', ')}`).toEqual([]);
		expect(documented).toContain('containerContract');
	});
});

// ── Non-vacuity self-tests ───────────────────────────────────────────────────
// A parser that finds nothing lets both directions pass on empty sets, which is the
// failure this census exists to prevent.

describe('G4.53 parse non-vacuity', () => {
	it('finds the real section and a representative field of each tier', () => {
		expect(documented.length).toBeGreaterThanOrEqual(DESCRIPTOR_FIELDS.length);
		expect(documented).toEqual(expect.arrayContaining(['mergeRole', 'rebuildRaw', 'blockFocus']));
	});

	it('stops the section at the next heading', () => {
		const section = fieldReferenceSection(doc);
		expect(section).toContain('The admission bar');
		expect(section).not.toContain('Presentation-mode reads');
	});

	it('reads the field column and drops the header, rule and prose cells', () => {
		expect(
			parseFieldRows(
				[
					'| Field | Tier |',
					'| ----- | ---- |',
					'| `mergeRole` | any |',
					'| `bodyWrap` | container |',
					'| **The admission bar** | prose |'
				].join('\n')
			)
		).toEqual(['mergeRole', 'bodyWrap']);
	});

	it('both directions can fail', () => {
		const oneRow = parseFieldRows('| `mergeRole` | any |');
		expect(DESCRIPTOR_FIELDS.filter((f) => !oneRow.includes(f)).length).toBeGreaterThan(0);
		const live = new Set<string>(DESCRIPTOR_FIELDS);
		expect(parseFieldRows('| `retiredField` | any |').filter((f) => !live.has(f))).toEqual([
			'retiredField'
		]);
	});
});
