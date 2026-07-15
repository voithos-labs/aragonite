/**
 * Coordinate-space brand mints stay enumerable (`docs/contributing/culture.md`
 * § "offset arithmetic has one home"). Two rules over editor source:
 *
 * 1. A bare `as <Brand>` cast exists only in its brand's home module — the
 *    numeric spaces in `cursor/coordinate-spaces.ts`, the `DocPath` path brand
 *    in `selection/path-math.ts`. Everywhere else calls a mint function.
 * 2. An `as<Brand>(…)` mint call exists only in the space home modules and the
 *    declared door files below, so every boundary cast stays findable by
 *    reading one list.
 *
 * Named conversion calls (`toRawOffset`, `toDomTextOffset`, `toEditorX`,
 * `toViewportX`) and the `extendDocPath` compose helper are the sanctioned
 * inter-space arithmetic and are unrestricted.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources } from './scan-source';

const COORDINATE_HOME = 'src/lib/cursor/coordinate-spaces.ts';
const DOCPATH_HOME = 'src/lib/selection/path-math.ts';

/** Where each brand's bare `as <Brand>` cast (its mint body) is allowed to live. */
const BRAND_CAST_HOME: Record<string, string> = {
	RawOffset: COORDINATE_HOME,
	DomTextOffset: COORDINATE_HOME,
	EditorX: COORDINATE_HOME,
	ViewportX: COORDINATE_HOME,
	CellIndex: COORDINATE_HOME,
	DocPath: DOCPATH_HOME
};

/**
 * Files permitted to call an `as*` boundary mint, each with the reason the
 * plain value it launders cannot be branded yet. Adding a mint call anywhere
 * else trips this guard; a new entry here is a new declared door and should be
 * reviewed as one.
 */
const MINT_ALLOWLIST: Record<string, string> = {
	[COORDINATE_HOME]: 'the numeric-space mint definitions themselves',
	[DOCPATH_HOME]: 'DocPath home — the doc-absolute path mint + extend helper',

	// ── Space homes ───────────────────────────────────────────────────────────
	'src/lib/cursor/widget-offset.ts': 'DomTextOffset home — the walk mints its returns',
	'src/lib/cursor/content-offsets.ts': 'DomTextOffset home (widget-free variant)',
	'src/lib/cursor/sticky-measure.ts': 'EditorX/ViewportX home + walk-offset candidate scan',
	'src/lib/ambient/ambient-cursor.ts':
		'RawOffset home — the ambient seam mints raw from walk space',
	'src/lib/selection/table-endpoint-snap.ts':
		'CellIndex home — row-major cell index minted from table geometry',
	'src/lib/selection/primitives.ts':
		'SelectionPoint accessors mint RawOffset/CellIndex for the char/cell branch reads',
	'src/lib/editor-actions/block-edit-scope.ts':
		"DocPath mint home — the scope factories mint the commit args' doc-absolute paths",
	'src/lib/editor-actions/commit/undo-controller.ts':
		'DocPath mint at the commit ceremony, gating the G1.16 guard entry',

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

const BRAND_CAST_RE = /\bas\s+(RawOffset|DomTextOffset|EditorX|ViewportX|CellIndex|DocPath)\b/;
const MINT_CALL_RE = /\bas(RawOffset|DomTextOffset|EditorX|ViewportX|CellIndex|DocPath)\s*\(/;

interface BrandHit {
	relPath: string;
	token: string;
	brand: string;
}

function findHits(re: RegExp, relPath: string, code: string): BrandHit[] {
	const global = new RegExp(re.source, 'g');
	const hits: BrandHit[] = [];
	let m: RegExpExecArray | null;
	while ((m = global.exec(code)) !== null) {
		hits.push({ relPath, token: m[0], brand: m[1] });
	}
	return hits;
}

describe('coordinate-space brand mints stay at their declared doors', () => {
	const sources = collectEditorSources();

	it('inspected at least one editor source file', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it("every bare `as <Brand>` cast lives in its brand's home module", () => {
		const violations = sources
			.flatMap((f) => findHits(BRAND_CAST_RE, f.relPath, f.code))
			.filter((hit) => hit.relPath !== BRAND_CAST_HOME[hit.brand]);
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

	const ALL_BRANDS = ['RawOffset', 'DomTextOffset', 'EditorX', 'ViewportX', 'CellIndex', 'DocPath'];

	it('matcher flags a bare brand cast for each brand', () => {
		for (const brand of ALL_BRANDS) {
			expect(findHits(BRAND_CAST_RE, 'synthetic.ts', `const x = n as ${brand};`)).toEqual([
				{ relPath: 'synthetic.ts', token: `as ${brand}`, brand }
			]);
		}
	});

	it('matcher flags a mint call for each brand', () => {
		for (const brand of ALL_BRANDS) {
			expect(findHits(MINT_CALL_RE, 'synthetic.ts', `f(as${brand}(3));`)).toEqual([
				{ relPath: 'synthetic.ts', token: `as${brand}(`, brand }
			]);
		}
	});

	it('matcher ignores type positions, longer identifiers, and conversions', () => {
		const benign =
			'import { toRawOffset, type RawOffset } from "./coordinate-spaces";\n' +
			'import { extendDocPath, type DocPath } from "./path-math";\n' +
			'const a: RawOffset = toRawOffset(b, 2);\n' +
			'const p: DocPath = extendDocPath(parent, 0);\n' +
			'const c = x as RawOffsetLike;\n' +
			'asRawOffsetFixture(3);';
		expect(findHits(BRAND_CAST_RE, 'synthetic.ts', benign)).toEqual([]);
		expect(findHits(MINT_CALL_RE, 'synthetic.ts', benign)).toEqual([]);
	});
});
