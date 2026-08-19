import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import type { CstNode, Document } from '$lib/core/nodes';
import { makeSearchReplace, scanCompiled } from '$lib/test/harness/search-replace';

// `docs/design/editor.md` §10: a replacement into a table cell escapes the delimiters the
// cell's raw reserves so it cannot split the row. Escaping the replacement string alone
// mis-handles a backslash on either side of the seam, and the row reparses one cell wider.

/** Literal matches inside table cells, as `{path, start, end}` scan results. */
function scanCells(doc: Document, needle: string) {
	const out: { path: number[]; start: number; end: number }[] = [];
	doc.children.forEach((table: CstNode, t) => {
		(table.children ?? []).forEach((row, r) => {
			(row.children ?? []).forEach((cell, c) => {
				let from = 0;
				let at: number;
				while ((at = cell.raw.indexOf(needle, from)) !== -1) {
					out.push({ path: [t, r, c], start: at, end: at + needle.length });
					from = at + needle.length;
				}
			});
		});
	});
	return out;
}

/** Cell raws of the first table's body row, as the document round-trips. */
function bodyCells(deps: { doc: Document }): string[] {
	const reparsed = parse(serialize(deps.doc));
	return (reparsed.children[0].children?.[1].children ?? []).map((c) => c.raw);
}

const TABLE = '| h1 | h2 |\n| --- | --- |\n| X | keep |\n';

describe('search/replace into a table cell', () => {
	it('keeps an already-escaped pipe in the replacement escaped exactly once', async () => {
		const { deps, sr } = makeSearchReplace(TABLE);

		await sr.replaceAll(scanCells(deps.doc, 'X'), 'a\\|b');

		expect(bodyCells(deps)).toEqual(['a\\|b', 'keep']);
	});

	it('escapes a bare pipe in the replacement', async () => {
		const { deps, sr } = makeSearchReplace(TABLE);

		await sr.replaceAll(scanCells(deps.doc, 'X'), 'a|b');

		expect(bodyCells(deps)).toEqual(['a\\|b', 'keep']);
	});

	// The freeing backslash comes from the cell, not the replacement, so the escape has to
	// see the whole substituted raw.
	it('does not double-escape a pipe that follows a backslash already in the cell', async () => {
		const { deps, sr } = makeSearchReplace('| h1 | h2 |\n| --- | --- |\n| a\\X | keep |\n');

		await sr.replaceAll(scanCells(deps.doc, 'X'), '|');

		expect(bodyCells(deps)).toEqual(['a\\|', 'keep']);
	});

	it('is idempotent — replacing into an already-escaped cell adds no backslashes', async () => {
		const { deps, sr } = makeSearchReplace('| h1 | h2 |\n| --- | --- |\n| a\\|X | keep |\n');

		await sr.replaceAll(scanCells(deps.doc, 'X'), 'Y');

		expect(bodyCells(deps)).toEqual(['a\\|Y', 'keep']);
	});

	it('collapses a newline in the replacement so it cannot spill into the next row', async () => {
		const { deps, sr } = makeSearchReplace(TABLE);

		await sr.replaceAll(scanCells(deps.doc, 'X'), 'a\nb');

		expect(bodyCells(deps)).toEqual(['a b', 'keep']);
	});

	// The real scanner, not `scanCells`: a paragraph has no cells to address, so the
	// cell-addressed driver hands this arm an empty match set and pins nothing.
	it('leaves a non-cell leaf’s replacement unescaped', async () => {
		const { deps, sr } = makeSearchReplace('para X here\n');

		await sr.replaceAll(scanCompiled(deps.doc, 'X', { caseSensitive: true }), 'a|b');

		expect(serialize(deps.doc)).toBe('para a|b here\n');
	});
});
