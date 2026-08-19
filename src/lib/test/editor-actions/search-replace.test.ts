import { describe, it, expect, beforeEach } from 'vitest';
import { serialize } from '$lib/core/serializer';
import { getBlockKindDescriptor, registerBlockKind } from '$lib/schema/block-kind-descriptor';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { testClosure } from '$lib/test/support/closure';
import { rangeSelectionOf } from '$lib/test/support/undo-entry';
import type { CstNode, Document } from '$lib/core/nodes';
import { createGrammarView } from '$lib/schema/block-openers';
import { makeSearchReplace, scanCompiled } from '$lib/test/harness/search-replace';
import { registerMermaidKind } from '$lib/plugins/mermaid/mermaid-kind';

// A minimal stand-in for search/document-scan.ts, which the container cases below use instead.
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
		const { deps, sr } = makeSearchReplace('> aXa\n>\n> bXb\n');

		await sr.replaceAll(scanForLiteral(deps.doc, 'X'), '\n\n');

		expect(deps.undoManager.getStacks().undo.length).toBe(1);
		expect(serialize(deps.doc)).not.toContain('X');
		expect(serialize(deps.doc)).toContain('a');
	});

	it('a match in a blockquote child + one in a nested list-item commit atomically', async () => {
		const { deps, sr } = makeSearchReplace('> outerX\n>\n> - itemX\n');

		await sr.replaceAll(scanForLiteral(deps.doc, 'X'), 'Y');

		expect(deps.undoManager.getStacks().undo.length).toBe(1);
		expect(serialize(deps.doc)).not.toContain('X');
		expect(serialize(deps.doc)).toContain('outerY');
		expect(serialize(deps.doc)).toContain('itemY');
	});

	it('replaces matches across two separate top-level subtrees in one entry', async () => {
		const { deps, sr } = makeSearchReplace('cat one\n\n- cat two\n');
		await sr.replaceAll(scanForLiteral(deps.doc, 'cat'), 'dog');
		expect(deps.undoManager.getStacks().undo.length).toBe(1);
		expect(serialize(deps.doc)).toBe('dog one\n\n- dog two\n');
	});

	it('replaces each found match exactly once (no re-scan of the replacement)', async () => {
		const { deps, sr } = makeSearchReplace('a a a\n');
		await sr.replaceAll(scanForLiteral(deps.doc, 'a'), 'aa');
		expect(serialize(deps.doc)).toBe('aa aa aa\n');
	});

	it('replaces text inside a table cell', async () => {
		const { deps, sr } = makeSearchReplace('| name | qty |\n| --- | --- |\n| cat | 2 |\n');
		await sr.replaceAll(scanForLiteral(deps.doc, 'cat'), 'dog');
		expect(serialize(deps.doc)).toContain('dog');
		expect(serialize(deps.doc)).not.toContain('cat');
	});

	it('collapses a newline in a regex table-cell replacement so no phantom row appears', async () => {
		const { deps, sr } = makeSearchReplace('| name | qty |\n| --- | --- |\n| cat | 2 |\n');
		// Regex mode supplies groups, which lets `\n` expand, so the cell escape must collapse it.
		const matches = scanForLiteral(deps.doc, 'cat').map((m) => ({ ...m, groups: ['cat'] }));
		await sr.replaceAll(matches, 'a\\nb');
		expect(deps.doc.children[0].children!.length).toBe(2);
		expect(deps.doc.children[0].children![1].children![0].raw.trim()).toBe('a b');
	});

	it('does not write through a snapshot-shared node (aliasing: pushed snapshot still serializes to pre-replace source)', async () => {
		const { deps, sr } = makeSearchReplace('> aXa\n>\n> bXb\n');
		const before = serialize(deps.doc);
		await sr.replaceAll(scanForLiteral(deps.doc, 'X'), 'ZZ');
		const snapshot = deps.undoManager.getStacks().undo[0].snapshot;
		expect(serialize(snapshot)).toBe(before);
	});

	it('seeds the undo snapshot with the deep match path for a nested replacement', async () => {
		const { deps, sr } = makeSearchReplace('- itemX\n');
		const match = scanForLiteral(deps.doc, 'X')[0];
		expect(match.path.length).toBeGreaterThan(1); // nested, so RED ≠ GREEN

		await sr.replaceOne(match, 'Y');

		const entry = deps.undoManager.getStacks().undo[0];
		expect(rangeSelectionOf(entry).anchor.path).toEqual(match.path);
		expect(rangeSelectionOf(entry).anchor.offset).toBe(match.start);
	});

	it('preserves the block id of an untouched top-level block', async () => {
		const { deps, sr, getBlockIds } = makeSearchReplace('keep me\n\nchange X\n');
		const idBefore = getBlockIds()[0];
		await sr.replaceAll(scanForLiteral(deps.doc, 'X'), 'Y');
		expect(getBlockIds()[0]).toBe(idBefore);
		expect(serialize(deps.doc)).toBe('keep me\n\nchange Y\n');
	});

	it('gives every container in a reparsed subtree childIds (reused container never reads undefined keys)', async () => {
		// The needle in item 1 makes replaceAll reparse the whole list. Without childIds on the
		// fresh listItem[0], the reused container's keyed-each collides on `undefined` keys.
		const { deps, sr } = makeSearchReplace(
			'1. First.\n\n   Continuation.\n2. Second with a needle sub.\n'
		);

		const matches = scanForLiteral(deps.doc, 'needle');
		expect(matches.length).toBeGreaterThan(0);
		// RED ≠ GREEN: one child cannot collide.
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
		const { deps, sr } = makeSearchReplace('the cat sat\n');
		await sr.replaceOne({ path: [0], start: 4, end: 7 }, 'dog');
		expect(serialize(deps.doc)).toBe('the dog sat\n');
		expect(deps.undoManager.getStacks().undo.length).toBe(1);
	});

	it('changes block kind when the replacement introduces a heading marker', async () => {
		const { deps, sr } = makeSearchReplace('title\n');
		await sr.replaceOne({ path: [0], start: 0, end: 0 }, '# ');
		expect(deps.doc.children[0].kind).toBe('heading');
	});

	// Parity with the top-level content commit: the reparse honors the instance grammar.
	it('honors the instance grammar — a disabled heading marker stays paragraph', async () => {
		const { deps, sr } = makeSearchReplace('title\n');
		deps.grammar = createGrammarView((kind) => kind !== 'heading');
		await sr.replaceOne({ path: [0], start: 0, end: 0 }, '# ');
		expect(deps.doc.children[0].kind).toBe('paragraph');
	});
});

describe('replace — matches on childless opaque containers are skipped', () => {
	// The real scanner: only it produces the container matches these pin.
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
		const { deps, sr } = makeSearchReplace([para, diagramNode]);

		const matches = scanCompiled(deps.doc, 'cat');
		expect(matches.map((m) => m.path)).toEqual([[0], [1]]); // leaf + container, so RED ≠ GREEN

		const replaced = await sr.replaceAll(matches, 'dog');

		expect(replaced).toBe(1);
		expect(serialize(deps.doc)).toContain('prose dog');
		expect(deps.doc.children[1].kind).toBe(diagramNode.kind);
		expect(deps.doc.children[1].raw).toBe(DIAGRAM_RAW);
		expect(deps.undoManager.getStacks().undo.length).toBe(1);
	});

	it('replaceOne on a container match is a no-op with no undo entry', async () => {
		const { deps, sr } = makeSearchReplace([diagramNode]);

		const match = scanCompiled(deps.doc, 'cat')[0];
		expect(match.path).toEqual([0]);

		const replaced = await sr.replaceOne(match, 'dog');

		expect(replaced).toBe(0);
		expect(deps.doc.children[0].raw).toBe(DIAGRAM_RAW);
		expect(deps.undoManager.getStacks().undo.length).toBe(0);
	});
});

describe('replace — a batch that applies nothing leaves no undo entry', () => {
	// Miss-analysis: the undo assertions all counted entries after a SUCCESSFUL batch, and the
	// throw arm was pinned on its error event alone — so the snapshot pushed before the loop, the
	// one register no commit ceremony covers, had no case looking at it on the failing path.
	it('restores the stacks when the first subtree throws in its rebuild', async () => {
		__resetSchemaRegistriesForTests();
		const brittle = declarePluginKind('replace-brittle');
		registerBlockKind(brittle, {
			mergeRole: 'container',
			editable: true,
			supportsInline: false,
			closure: testClosure,
			container: {
				contract: 'opaque',
				rebuildRaw: () => {
					throw new Error('rebuild refused');
				}
			}
		});
		const child: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: 'prose cat\n' };
		const node: CstNode = {
			kind: brittle,
			leadingTrivia: '',
			raw: 'prose cat\n',
			children: [child]
		};
		const { deps, sr } = makeSearchReplace([node]);
		const errors: unknown[] = [];
		deps.events.on('error', (e) => void errors.push(e));

		const replaced = await sr.replaceAll([{ path: [0, 0], start: 6, end: 9 }], 'dog');

		expect(replaced).toBe(0);
		expect(errors).toHaveLength(1);
		expect(deps.undoManager.getStacks().undo).toEqual([]);
	});
});

describe('replace — a childless opaque container reparses its own bytes', () => {
	// Miss-analysis (#41): the container arm was pinned only by its DECLINE, with a fixture kind
	// whose opener was never registered — so the decline read as "containers are excluded" when
	// the real rule is kind stability, and the reachable half (a registered kind that survives the
	// substitution) had no case at all.
	beforeEach(() => {
		__resetSchemaRegistriesForTests();
		registerMermaidKind();
	});

	it('substitutes inside the diagram and comes back the same kind', async () => {
		const { deps, sr } = makeSearchReplace('```mermaid\ngraph cat\n```\n');

		const matches = scanCompiled(deps.doc, 'cat');
		expect(matches.map((m) => m.path)).toEqual([[0]]);
		expect(await sr.replaceAll(matches, 'dog')).toBe(1);

		expect(deps.doc.children[0].kind).toBe('mermaid');
		expect(serialize(deps.doc)).toBe('```mermaid\ngraph dog\n```\n');
	});

	// The one hazard the reparse cannot absorb: bytes that break the opener line.
	it('declines a substitution that would reparse as a different kind', async () => {
		const { deps, sr } = makeSearchReplace('```mermaid\ngraph cat\n```\n');

		const matches = scanCompiled(deps.doc, 'mermaid');
		expect(await sr.replaceAll(matches, 'js')).toBe(0);
		expect(deps.doc.children[0].kind).toBe('mermaid');
		expect(serialize(deps.doc)).toBe('```mermaid\ngraph cat\n```\n');
	});
});
