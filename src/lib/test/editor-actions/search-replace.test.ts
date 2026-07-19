import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { getBlockKindDescriptor, registerBlockKind } from '$lib/schema/block-kind-descriptor';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { testClosure } from '$lib/test/support/closure';
import type { CstNode, Document } from '$lib/core/nodes';
import { compileMatcher } from '$lib/search/matcher';
import { createGrammarView } from '$lib/schema/block-openers';
import { scanDocument } from '$lib/search/document-scan';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createSearchReplace } from '$lib/editor-actions/search-replace';
import { makeEditorActionsDeps } from '../harness/editor-actions';

// Minimal literal scan for tests (the real scan is search/document-scan.ts):
// walk containers, find a literal in non-container leaf raw, return {path,start,end}.
function scanForLiteral(doc: Document, needle: string) {
	const out: { path: number[]; start: number; end: number }[] = [];
	const walk = (nodes: CstNode[], prefix: number[]) => {
		nodes.forEach((n, i) => {
			const path = [...prefix, i];
			if (getBlockKindDescriptor(n.kind).isContainer) {
				walk(n.children ?? [], path);
				return;
			}
			let from = 0;
			let at: number;
			while ((at = n.raw.indexOf(needle, from)) !== -1) {
				out.push({ path, start: at, end: at + needle.length });
				from = at + needle.length;
			}
		});
	};
	walk(doc.children, []);
	return out;
}

describe('replaceAll — per-top-level-subtree, one undo entry', () => {
	it('two matches in two children of one blockquote, both splitting, commit as ONE undo entry', async () => {
		const doc = parse('> aXa\n>\n> bXb\n');
		const { deps } = makeEditorActionsDeps(doc.children);
		const sr = createSearchReplace(deps, createUndoController(deps));

		await sr.replaceAll(scanForLiteral(deps.doc, 'X'), '\n\n');

		expect(deps.undoManager.getStacks().undo.length).toBe(1);
		expect(serialize(deps.doc)).not.toContain('X');
		expect(serialize(deps.doc)).toContain('a');
	});

	it('a match in a blockquote child + one in a nested list-item commit atomically', async () => {
		const doc = parse('> outerX\n>\n> - itemX\n');
		const { deps } = makeEditorActionsDeps(doc.children);
		const sr = createSearchReplace(deps, createUndoController(deps));

		await sr.replaceAll(scanForLiteral(deps.doc, 'X'), 'Y');

		expect(deps.undoManager.getStacks().undo.length).toBe(1);
		expect(serialize(deps.doc)).not.toContain('X');
		expect(serialize(deps.doc)).toContain('outerY');
		expect(serialize(deps.doc)).toContain('itemY');
	});

	it('replaces matches across two separate top-level subtrees in one entry', async () => {
		const doc = parse('cat one\n\n- cat two\n');
		const { deps } = makeEditorActionsDeps(doc.children);
		const sr = createSearchReplace(deps, createUndoController(deps));
		await sr.replaceAll(scanForLiteral(deps.doc, 'cat'), 'dog');
		expect(deps.undoManager.getStacks().undo.length).toBe(1);
		expect(serialize(deps.doc)).toBe('dog one\n\n- dog two\n');
	});

	it('replaces each found match exactly once (no re-scan of the replacement)', async () => {
		const doc = parse('a a a\n');
		const { deps } = makeEditorActionsDeps(doc.children);
		const sr = createSearchReplace(deps, createUndoController(deps));
		await sr.replaceAll(scanForLiteral(deps.doc, 'a'), 'aa');
		expect(serialize(deps.doc)).toBe('aa aa aa\n');
	});

	it('replaces text inside a table cell', async () => {
		const doc = parse('| name | qty |\n| --- | --- |\n| cat | 2 |\n');
		const { deps } = makeEditorActionsDeps(doc.children);
		const sr = createSearchReplace(deps, createUndoController(deps));
		await sr.replaceAll(scanForLiteral(deps.doc, 'cat'), 'dog');
		expect(serialize(deps.doc)).toContain('dog');
		expect(serialize(deps.doc)).not.toContain('cat');
	});

	it('escapes a pipe in a table-cell replacement so the row keeps its cells', async () => {
		const doc = parse('| name | qty |\n| --- | --- |\n| cat | 2 |\n');
		const { deps } = makeEditorActionsDeps(doc.children);
		const sr = createSearchReplace(deps, createUndoController(deps));
		await sr.replaceAll(scanForLiteral(deps.doc, 'cat'), 'a|b');
		const bodyCells = deps.doc.children[0].children![1].children!;
		expect(bodyCells.length).toBe(2); // not split into three by the literal pipe
		expect(bodyCells[1].raw.trim()).toBe('2'); // adjacent cell not displaced
		expect(serialize(deps.doc)).toContain('a\\|b'); // escaped in source
	});

	it('collapses a newline in a regex table-cell replacement so no phantom row appears', async () => {
		const doc = parse('| name | qty |\n| --- | --- |\n| cat | 2 |\n');
		const { deps } = makeEditorActionsDeps(doc.children);
		const sr = createSearchReplace(deps, createUndoController(deps));
		// Regex mode supplies groups, which lets `\n` expand; the cell escape must
		// then collapse it so the table doesn't gain a row.
		const matches = scanForLiteral(deps.doc, 'cat').map((m) => ({ ...m, groups: ['cat'] }));
		await sr.replaceAll(matches, 'a\\nb');
		expect(deps.doc.children[0].children!.length).toBe(2); // header + one body row
		expect(deps.doc.children[0].children![1].children![0].raw.trim()).toBe('a b');
	});

	it('does not write through a snapshot-shared node (aliasing: pushed snapshot still serializes to pre-replace source)', async () => {
		const doc = parse('> aXa\n>\n> bXb\n');
		const { deps } = makeEditorActionsDeps(doc.children);
		const sr = createSearchReplace(deps, createUndoController(deps));
		const before = serialize(deps.doc);
		await sr.replaceAll(scanForLiteral(deps.doc, 'X'), 'ZZ');
		const snapshot = deps.undoManager.getStacks().undo[0].snapshot;
		expect(serialize(snapshot)).toBe(before);
	});

	it('seeds the undo snapshot with the deep match path for a nested replacement', async () => {
		const doc = parse('- itemX\n');
		const { deps } = makeEditorActionsDeps(doc.children);
		const sr = createSearchReplace(deps, createUndoController(deps));
		const match = scanForLiteral(deps.doc, 'X')[0];
		expect(match.path.length).toBeGreaterThan(1); // genuinely nested, so RED ≠ GREEN

		await sr.replaceOne(match, 'Y');

		const entry = deps.undoManager.getStacks().undo[0];
		expect(entry.selection.anchor.path).toEqual(match.path);
		expect(entry.selection.anchor.offset).toBe(match.start);
	});

	it('preserves the block id of an untouched top-level block', async () => {
		const doc = parse('keep me\n\nchange X\n');
		const { deps, getBlockIds } = makeEditorActionsDeps(doc.children);
		const idBefore = getBlockIds()[0];
		const sr = createSearchReplace(deps, createUndoController(deps));
		await sr.replaceAll(scanForLiteral(deps.doc, 'X'), 'Y');
		expect(getBlockIds()[0]).toBe(idBefore);
		expect(serialize(deps.doc)).toBe('keep me\n\nchange Y\n');
	});

	it('gives every container in a reparsed subtree childIds (reused container never reads undefined keys)', async () => {
		// item 0 = paragraph + continuation paragraph (≥2 children); the needle lives
		// in item 1, so replaceAll reparses the whole top-level list. The fresh
		// listItem[0] must arrive with childIds or a reused container's keyed-each
		// renders `undefined` keys and the ≥2 children collide on a duplicate key.
		const doc = parse('1. First.\n\n   Continuation.\n2. Second with a needle sub.\n');
		const { deps } = makeEditorActionsDeps(doc.children);
		const sr = createSearchReplace(deps, createUndoController(deps));

		const matches = scanForLiteral(deps.doc, 'needle');
		expect(matches.length).toBeGreaterThan(0);
		// Genuinely a ≥2-child list item, so RED ≠ GREEN (one child can't collide).
		expect(deps.doc.children[0].children![0].children!.length).toBeGreaterThanOrEqual(2);

		await sr.replaceAll(matches, 'love');

		const violations: { path: number[]; childrenLen: number; idsLen: number }[] = [];
		const walk = (node: CstNode, path: number[]) => {
			if (!node.children || node.children.length === 0) return;
			const idsLen = node.childIds?.length ?? -1;
			if (idsLen !== node.children.length) {
				violations.push({ path, childrenLen: node.children.length, idsLen });
			}
			node.children.forEach((c, i) => walk(c, [...path, i]));
		};
		walk(deps.doc.children[0], [0]);
		expect(violations).toEqual([]);
	});
});

describe('replaceOne — single-subtree case', () => {
	it('replaces a single match and keeps one undo entry', async () => {
		const doc = parse('the cat sat\n');
		const { deps } = makeEditorActionsDeps(doc.children);
		const sr = createSearchReplace(deps, createUndoController(deps));
		await sr.replaceOne({ path: [0], start: 4, end: 7 }, 'dog');
		expect(serialize(deps.doc)).toBe('the dog sat\n');
		expect(deps.undoManager.getStacks().undo.length).toBe(1);
	});

	it('changes block kind when the replacement introduces a heading marker', async () => {
		const doc = parse('title\n');
		const { deps } = makeEditorActionsDeps(doc.children);
		const sr = createSearchReplace(deps, createUndoController(deps));
		await sr.replaceOne({ path: [0], start: 0, end: 0 }, '# ');
		expect(deps.doc.children[0].kind).toBe('heading');
	});

	// Parity with the top-level content commit: the reparse honors the instance
	// grammar, so an introduced marker for a disabled kind stays unmaterialized.
	it('honors the instance grammar — a disabled heading marker stays paragraph', async () => {
		const doc = parse('title\n');
		const { deps } = makeEditorActionsDeps(doc.children);
		deps.grammar = createGrammarView((kind) => kind !== 'heading');
		const sr = createSearchReplace(deps, createUndoController(deps));
		await sr.replaceOne({ path: [0], start: 0, end: 0 }, '# ');
		expect(deps.doc.children[0].kind).toBe('paragraph');
	});
});

describe('replace — matches on childless opaque containers are skipped', () => {
	// The real scanner (not scanForLiteral): only it produces the container
	// matches whose replace behavior these tests pin.
	function scanFor(doc: Document, q: string) {
		const r = compileMatcher(q, { caseSensitive: false, wholeWord: false, regex: false });
		if (!r.ok) throw new Error(r.error);
		return scanDocument(doc, r.matcher);
	}

	const DIAGRAM_RAW = '```diagram\ngraph cat\n```\n';
	let diagramNode: CstNode;
	beforeEach(() => {
		__resetSchemaRegistriesForTests();
		const diagram = declarePluginKind('replace-diagram');
		registerBlockKind(diagram, {
			mergeRole: 'not-mergeable',
			editable: true,
			supportsInline: false,
			closure: testClosure,
			container: { contract: 'opaque', rebuildRaw: () => {} }
		});
		diagramNode = { kind: diagram, leadingTrivia: '\n', raw: DIAGRAM_RAW, children: [] };
	});

	it('replaceAll applies only leaf matches and reports the real count', async () => {
		const para: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: 'prose cat\n' };
		const { deps } = makeEditorActionsDeps([para, diagramNode]);
		const sr = createSearchReplace(deps, createUndoController(deps));

		const matches = scanFor(deps.doc, 'cat');
		expect(matches.map((m) => m.path)).toEqual([[0], [1]]); // leaf + container, so RED ≠ GREEN

		const replaced = await sr.replaceAll(matches, 'dog');

		expect(replaced).toBe(1);
		expect(serialize(deps.doc)).toContain('prose dog');
		expect(deps.doc.children[1].kind).toBe(diagramNode.kind);
		expect(deps.doc.children[1].raw).toBe(DIAGRAM_RAW);
		expect(deps.undoManager.getStacks().undo.length).toBe(1);
	});

	it('replaceOne on a container match is a no-op with no undo entry', async () => {
		const { deps } = makeEditorActionsDeps([diagramNode]);
		const sr = createSearchReplace(deps, createUndoController(deps));

		const match = scanFor(deps.doc, 'cat')[0];
		expect(match.path).toEqual([0]);

		const replaced = await sr.replaceOne(match, 'dog');

		expect(replaced).toBe(0);
		expect(deps.doc.children[0].raw).toBe(DIAGRAM_RAW);
		expect(deps.undoManager.getStacks().undo.length).toBe(0);
	});
});
