import { describe, it, expect } from 'vitest';
import { parse } from '$lib/editor/core/parser';
import { serialize } from '$lib/editor/core/serializer';
import { getBlockKindDescriptor } from '$lib/editor/schema/block-kind-descriptor';
import type { CstNode, Document } from '$lib/editor/core/nodes';
import { createUndoController } from '$lib/editor/editor-actions/undo/undo-controller';
import { createSearchReplace } from '$lib/editor/editor-actions/search-replace';
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

	it('does not write through a snapshot-shared node (aliasing: pushed snapshot still serializes to pre-replace source)', async () => {
		const doc = parse('> aXa\n>\n> bXb\n');
		const { deps } = makeEditorActionsDeps(doc.children);
		const sr = createSearchReplace(deps, createUndoController(deps));
		const before = serialize(deps.doc);
		await sr.replaceAll(scanForLiteral(deps.doc, 'X'), 'ZZ');
		const snapshot = deps.undoManager.getStacks().undo[0].snapshot;
		expect(serialize(snapshot)).toBe(before);
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
});
