/**
 * Coordinate-space brand mints stay enumerable (`docs/contributing/culture.md`
 * § "offset arithmetic has one home"). Two rules over editor source:
 *
 * 1. A bare `as <Brand>` cast exists only in `cursor/coordinate-spaces.ts` —
 *    the conversion and mint bodies. Everywhere else calls a mint function.
 * 2. An `as<Brand>(…)` mint call exists only in the space home modules and the
 *    declared public-door files below, so every boundary cast stays findable
 *    by reading one list.
 *
 * Named conversion calls (`toRawOffset`, `toDomTextOffset`, `toEditorX`,
 * `toViewportX`) are the sanctioned inter-space arithmetic and are
 * unrestricted.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources } from './scan-source';

const BRAND_HOME = 'src/lib/cursor/coordinate-spaces.ts';

/**
 * Files permitted to call an `as*` boundary mint, each with the reason the
 * plain number it launders cannot be branded yet. Adding a mint call anywhere
 * else trips this guard; a new entry here is a new declared door and should be
 * reviewed as one.
 */
const MINT_ALLOWLIST: Record<string, string> = {
	[BRAND_HOME]: 'the mint definitions themselves',

	// ── Space homes ───────────────────────────────────────────────────────────
	'src/lib/cursor/widget-offset.ts': 'DomTextOffset home — the walk mints its returns',
	'src/lib/cursor/content-offsets.ts': 'DomTextOffset home (widget-free variant)',
	'src/lib/cursor/sticky-measure.ts': 'EditorX/ViewportX home + walk-offset candidate scan',
	'src/lib/ambient/ambient-cursor.ts':
		'RawOffset home — the ambient seam mints raw from walk space',

	// ── Public doors (number-typed surfaces minting at entry) ─────────────────
	'src/lib/components/blocks/editable-surface.ts':
		'BlockComponent door — public number offsets minted at entry',
	'src/lib/components/blocks/editable-leaf.ts':
		'plugin-leaf backend — zero-ambient surface where DOM-text space is raw space',
	'src/lib/components/blocks/code/CodeBlock.svelte':
		'code backend — zero-ambient surface where DOM-text space is raw space',
	'src/lib/components/blocks/text/TextEditableBlock.svelte':
		'pending-caret restore holds a plain number field',
	'src/lib/components/blocks/table/TableCellBlock.svelte':
		'zero-ambient cell — pending-caret restore + focus-offset walk read mint across the identity',
	'src/lib/components/blocks/table/TableBlock.svelte':
		'table sticky-X exit re-enters the editor column state',
	'src/lib/components/blocks/text/widget-interaction.ts':
		'CST inline offsets (unbranded model values) enter cursor IO',
	'src/lib/cursor/reveal-source.ts': 'block-source offsets (unbranded deps) enter the walk',
	'src/lib/selection/native-bridge.ts': 'SelectionPoint offsets (unbranded) enter the walk',
	'src/lib/selection/cross-block/keydown.ts':
		'textContent length is a DomTextOffset by construction',
	'src/lib/decorations/island-dom.ts': 'decoration model offsets (unbranded) enter the walk'
};

const BRAND_CAST_RE = /\bas\s+(RawOffset|DomTextOffset|EditorX|ViewportX|CellIndex)\b/;
const MINT_CALL_RE = /\bas(RawOffset|DomTextOffset|EditorX|ViewportX|CellIndex)\s*\(/;

interface BrandHit {
	relPath: string;
	token: string;
}

function findHits(re: RegExp, relPath: string, code: string): BrandHit[] {
	const global = new RegExp(re.source, 'g');
	const hits: BrandHit[] = [];
	let m: RegExpExecArray | null;
	while ((m = global.exec(code)) !== null) {
		hits.push({ relPath, token: m[0] });
	}
	return hits;
}

describe('coordinate-space brand mints stay at their declared doors', () => {
	const sources = collectEditorSources();

	it('inspected at least one editor source file', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it('every bare `as <Brand>` cast lives in coordinate-spaces.ts', () => {
		const violations = sources
			.flatMap((f) => findHits(BRAND_CAST_RE, f.relPath, f.code))
			.filter((hit) => hit.relPath !== BRAND_HOME);
		expect(violations).toEqual([]);
	});

	it('every `as*` mint call lives in an allowlisted home or door file', () => {
		const violations = sources
			.flatMap((f) => findHits(MINT_CALL_RE, f.relPath, f.code))
			.filter((hit) => !(hit.relPath in MINT_ALLOWLIST));
		expect(violations).toEqual([]);
	});

	it('every allowlist entry still mints (no dead allowlist)', () => {
		const byPath = new Map(sources.map((f) => [f.relPath, f]));
		for (const relPath of Object.keys(MINT_ALLOWLIST)) {
			const file = byPath.get(relPath);
			expect(file, `allowlisted file not found: ${relPath}`).toBeDefined();
			expect(MINT_CALL_RE.test(file!.code), `allowlist stale for ${relPath}`).toBe(true);
		}
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('matcher flags a bare brand cast for each brand', () => {
		for (const brand of ['RawOffset', 'DomTextOffset', 'EditorX', 'ViewportX', 'CellIndex']) {
			expect(findHits(BRAND_CAST_RE, 'synthetic.ts', `const x = n as ${brand};`)).toEqual([
				{ relPath: 'synthetic.ts', token: `as ${brand}` }
			]);
		}
	});

	it('matcher flags a mint call for each brand', () => {
		for (const brand of ['RawOffset', 'DomTextOffset', 'EditorX', 'ViewportX', 'CellIndex']) {
			expect(findHits(MINT_CALL_RE, 'synthetic.ts', `f(as${brand}(3));`)).toEqual([
				{ relPath: 'synthetic.ts', token: `as${brand}(` }
			]);
		}
	});

	it('matcher ignores type positions, longer identifiers, and conversions', () => {
		const benign =
			'import { toRawOffset, type RawOffset } from "./coordinate-spaces";\n' +
			'const a: RawOffset = toRawOffset(b, 2);\n' +
			'const c = x as RawOffsetLike;\n' +
			'asRawOffsetFixture(3);';
		expect(findHits(BRAND_CAST_RE, 'synthetic.ts', benign)).toEqual([]);
		expect(findHits(MINT_CALL_RE, 'synthetic.ts', benign)).toEqual([]);
	});
});
