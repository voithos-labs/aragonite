/**
 * G4.13 — the unshare seam is the only view→mutable door. `core/node-views.ts`
 * states G1.9 in the type system: readers hold bytes-readonly views, and a
 * cast back to `CstNode`/`Document` re-opens the byte-write hazard the type
 * closed. The sanctioned zones are `tree-operations/` (the unshare/clone door
 * and ops that already own their nodes) and the commit ceremony
 * (`editor-actions/commit/`), whose scope views are runtime-proven owned.
 * Anywhere else, a view-stripping cast fails this scan.
 *
 * `as Document` is counted only in files that import the CST `Document` from
 * `core/nodes` — elsewhere the identifier is the DOM `Document`
 * (`blockEl.ownerDocument` casts in selection/native-bridge.ts). Named type
 * aliases of the node shape are out of scope by design: the reviewable rule is
 * the two type names, and an alias minted to dodge the scan would not survive
 * review.
 */
import { describe, it, expect } from 'vitest';
import { collectEditorSources, stripComments } from './scan-source';

// `as CstNode` / `as Document`, including the tail of `as unknown as X`;
// excludes indexed-access types (`as CstNode['metadata']`).
const STRIP_CAST_RE = /\bas\s+(CstNode|Document)\b(?!\s*\[\s*')/g;

const CST_DOCUMENT_IMPORT_RE = /import[^;]*\bDocument\b[^;]*from\s+'[^']*core\/nodes'/;

const SANCTIONED_ZONES = ['src/lib/tree-operations/', 'src/lib/editor-actions/commit/'];

const RULE =
	'view→mutable conversion lives ONLY at the unshare/clone seam and the commit ceremony ' +
	`(${SANCTIONED_ZONES.join(', ')}); route the write through them instead of casting`;

function stripCasts(code: string, countsDocument: boolean): string[] {
	const hits: string[] = [];
	for (const m of code.matchAll(STRIP_CAST_RE)) {
		if (m[1] === 'Document' && !countsDocument) continue;
		hits.push(m[0]);
	}
	return hits;
}

describe('G4.13 view-stripping casts stay inside the door zones', () => {
	const sources = collectEditorSources();

	it('inspected at least one editor source file', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it('no view-stripping cast outside the sanctioned zones', () => {
		const offenders = sources
			.filter((f) => !SANCTIONED_ZONES.some((zone) => f.relPath.startsWith(zone)))
			.map((f) => ({
				relPath: f.relPath,
				hits: stripCasts(f.code, CST_DOCUMENT_IMPORT_RE.test(f.code))
			}))
			.filter((f) => f.hits.length > 0);
		expect(offenders, RULE).toEqual([]);
	});

	it('the unshare seam still holds a live door cast (no dead sanction)', () => {
		const unshare = sources.find((f) => f.relPath === 'src/lib/tree-operations/unshare.ts');
		expect(unshare, 'unshare.ts moved — update the sanctioned zones').toBeDefined();
		expect(stripCasts(unshare!.code, true).length).toBeGreaterThan(0);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('matches the stripping shapes', () => {
		expect(stripCasts('const n = view as CstNode;', true)).toEqual(['as CstNode']);
		expect(stripCasts('const n = doc as unknown as CstNode;', true)).toEqual(['as CstNode']);
		expect(stripCasts('const d = view as Document;', true)).toEqual(['as Document']);
		expect(stripCasts('const d = (x as Document & { y?: number }).y;', true)).toEqual([
			'as Document'
		]);
		expect(stripCasts('x as CstNode | null', true)).toEqual(['as CstNode']);
	});

	it('skips non-stripping shapes', () => {
		expect(stripCasts("meta as CstNode['metadata']", true)).toEqual([]);
		expect(stripCasts('node as NodeView', true)).toEqual([]);
		expect(stripCasts('doc as DocumentView', true)).toEqual([]);
		expect(stripCasts('const node: CstNode = fresh();', true)).toEqual([]);
	});

	it('counts `as Document` only under a CST Document import', () => {
		expect(
			stripCasts('el.ownerDocument as Document & { caretRangeFromPoint?: never }', false)
		).toEqual([]);
		expect(
			CST_DOCUMENT_IMPORT_RE.test("import type { CstNode, Document } from '../core/nodes';")
		).toBe(true);
		expect(CST_DOCUMENT_IMPORT_RE.test("import type { SelectionPoint } from './primitives';")).toBe(
			false
		);
	});

	it('a cast inside a comment cannot trip the scan', () => {
		expect(
			stripCasts(stripComments('// never write `x as CstNode` here\nconst a = 1;'), true)
		).toEqual([]);
	});
});
