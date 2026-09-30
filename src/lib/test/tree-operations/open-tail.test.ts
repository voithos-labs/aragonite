// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import type { CstNode, Document } from '$lib/core/nodes';
import { endsOpen, endWindowLines, keepOpenTail } from '$lib/tree-operations/open-tail';
import { documentBody, type BodyParent } from '$lib/tree-operations/node-primitives';
import { createSharingState, type SharingState } from '$lib/tree-operations/sharing';
import { rebuildListRaw } from '$lib/schema/container-rebuilders';
import { checkStaleRaw } from '$lib/invariants/node-shape';
import { activateDirectiveGrammar } from '$lib/core/directive/activate';
import { DIRECTIVE_CONTAINER } from '$lib/core/directive/kinds';
import { defaultGrammarView } from '$lib/schema/block-openers';

/** The body of the list that is `source`'s first block, as a list scope's commit sees it. */
function listBody(source: string): BodyParent {
	const list = parse(source).children[0];
	return { children: list.children!, owner: list, lineEnding: '\n' };
}

/** A block placed at the end of `body`, as a commit's change reports it. */
function placeLast(body: BodyParent, node: CstNode, sharing = createSharingState()): void {
	body.children.push(node);
	endWindowLines(
		body,
		{ op: 'insert', at: body.children.length - 1, count: 1 },
		sharing,
		defaultGrammarView
	);
}

const item = (raw: string): CstNode => parse(raw).children[0].children![0];

describe('endsOpen', () => {
	it.each([
		['a', true],
		['a\n', false],
		['a\n\n', false],
		['', false]
	])('%j: %s', (source, open) => {
		expect(endsOpen(parse(source))).toBe(open);
	});
});

describe('endWindowLines', () => {
	it('ends the block above a placed block and the placed block, and nothing past the window', () => {
		const doc = parse('a\n\nb\n\nc');
		const body = documentBody(doc);
		body.children.splice(1, 0, { kind: 'paragraph', leadingTrivia: '\n', raw: 'x' });
		endWindowLines(
			body,
			{ op: 'insert', at: 1, count: 1 },
			createSharingState(),
			defaultGrammarView
		);
		expect(body.children.map((c) => c.raw)).toEqual(['a\n', 'x\n', 'b\n', 'c']);
	});

	it('ends the block a delete leaves above the removed one', () => {
		const doc = parse('a\n\nb');
		const body = documentBody(doc);
		body.children[0] = { ...body.children[0], raw: 'a' };
		body.children.splice(1, 1);
		endWindowLines(
			body,
			{ op: 'delete', at: 1, count: 1 },
			createSharingState(),
			defaultGrammarView
		);
		expect(body.children[0].raw).toBe('a\n');
	});

	it('writes the ending into a copy, never through a node an undo entry holds', () => {
		const doc = parse('a');
		const original = doc.children[0];
		const sharing: SharingState = createSharingState();
		sharing.markSnapshotTaken();
		placeLast(documentBody(doc), { kind: 'paragraph', leadingTrivia: '\n', raw: 'b' }, sharing);
		expect(original.raw).toBe('a');
		expect(doc.children[0].raw).toBe('a\n');
	});

	it('ends the lines in the body’s ending, not a literal LF', () => {
		const doc = parse('x\r\n\r\na');
		placeLast(documentBody(doc), { kind: 'paragraph', leadingTrivia: '\r\n', raw: 'b' });
		expect(serialize(doc)).toBe('x\r\n\r\na\r\n\r\nb\r\n');
	});

	it('ends an item through its last child, so the item’s raw and its body agree', () => {
		const body = listBody('- a');
		placeLast(body, item('- b'));
		expect(body.children[0].raw).toBe('- a\n');
		expect(body.children[0].children![0].raw).toBe('a\n');
	});

	// Ending a container's raw alone leaves its raw and children disagreeing (G1.1), and the next
	// rebuild runs its last item into the following one.
	it('descends into a nested container instead of patching its raw alone', () => {
		const body = listBody('- a\n  - b');
		const nested = body.children[0].children!.at(-1)!;
		expect(nested.kind).toBe('list');
		placeLast(body, item('- c'));
		expect(checkStaleRaw(body.children[0].children!.at(-1)!, defaultGrammarView)).toBeNull();
		expect(body.children[0].raw).toBe('- a\n  - b\n');
	});

	// A grid cell's bytes sit inside the row's line, so an ending appended there splits the row.
	// Miss-analysis: every descent case ended in a prose leaf or a strip container, never a cell.
	it('stops above a grid cell rather than splitting the row', () => {
		const source = '- | a | b |\n  | --- | --- |\n  | c | d |';
		const body = listBody(source);
		expect(body.children[0].children!.at(-1)!.kind).toBe('table');
		placeLast(body, item('- e'));
		expect(body.children[0].raw).toBe(source + '\n');
		expect(checkStaleRaw(body.children[0], defaultGrammarView)).toBeNull();
	});

	// `directiveContainer` is core's own `:::` fallback, so the opaque case needs no plugin.
	// Miss-analysis: no case drove the descent into an opaque body, where it fails silently.
	it('stops above an opaque container body rather than leaving the item unended', () => {
		activateDirectiveGrammar();
		const source = '- text\n\n  :::note Heads up\n  body\n  :::';
		const body = listBody(source);
		const opaque = body.children[0].children!.at(-1)!;
		expect(opaque.kind).toBe(DIRECTIVE_CONTAINER);
		const bodyRaws = opaque.children!.map((c) => c.raw);
		placeLast(body, item('- e'));
		expect(body.children[0].raw).toBe(source + '\n');
		expect(body.children[0].children!.at(-1)!.children!.map((c) => c.raw)).toEqual(bodyRaws);
		expect(checkStaleRaw(body.children[0], defaultGrammarView)).toBeNull();
	});

	it('keeps pasted items on their own lines once the list rebuilds', () => {
		const list = parse('1. one\n2. two\n').children[0];
		const pasted = parse('6. Ordered\n7. third').children[0].children!;
		list.children!.splice(1, 1, ...pasted);
		const body: BodyParent = { children: list.children!, owner: list, lineEnding: '\n' };
		endWindowLines(
			body,
			{ op: 'replace', at: 1, count: 1, newCount: 2 },
			createSharingState(),
			defaultGrammarView
		);
		rebuildListRaw(list);
		expect(list.raw).toBe('1. one\n6. Ordered\n7. third\n');
	});

	it('leaves a row’s cells alone: they sit inside the row’s line', () => {
		const table = parse('| a | b |\n| --- | --- |\n| c | d |').children[0];
		const row = table.children!.at(-1)!;
		const cells = row.children!.map((c) => c.raw);
		const body: BodyParent = { children: row.children!, owner: row, lineEnding: '\n' };
		endWindowLines(
			body,
			{ op: 'replace', at: 0, count: 2, newCount: 2 },
			createSharingState(),
			defaultGrammarView
		);
		expect(row.children!.map((c) => c.raw)).toEqual(cells);
	});
});

describe('keepOpenTail', () => {
	/** The document after a commit that ended every line, as `endWindowLines` leaves it. */
	function ended(source: string): Document {
		const doc = parse(source);
		const body = documentBody(doc);
		body.children.push({ kind: 'paragraph', leadingTrivia: '', raw: '' });
		endWindowLines(
			body,
			{ op: 'insert', at: body.children.length - 1, count: 1 },
			createSharingState(),
			defaultGrammarView
		);
		body.children.pop();
		return doc;
	}

	it('gives the ending up down the last line, container levels included', () => {
		const doc = ended('a\n\n> q\n>\n> r');
		expect(serialize(doc)).toBe('a\n\n> q\n>\n> r\n');
		keepOpenTail(doc, true, createSharingState(), defaultGrammarView);
		expect(serialize(doc)).toBe('a\n\n> q\n>\n> r');
		expect(doc.children[1].children!.at(-1)!.raw).toBe('r');
	});

	it('keeps a blank last line, which is nothing but its break', () => {
		const doc = parse('a\n\n\n');
		keepOpenTail(doc, true, createSharingState(), defaultGrammarView);
		expect(serialize(doc)).toBe('a\n\n\n');
	});

	it('keeps a fence’s empty last line', () => {
		const doc = parse('```\ncode\n\n');
		keepOpenTail(doc, true, createSharingState(), defaultGrammarView);
		expect(serialize(doc)).toBe('```\ncode\n\n');
	});

	it('releases a quote’s blank quote line, which keeps its marker', () => {
		const doc = ended('> q\n>');
		keepOpenTail(doc, true, createSharingState(), defaultGrammarView);
		expect(serialize(doc)).toBe('> q\n>');
	});

	it('does nothing to a document that ended in a line break', () => {
		const doc = parse('a\n');
		keepOpenTail(doc, false, createSharingState(), defaultGrammarView);
		expect(serialize(doc)).toBe('a\n');
	});

	it('does nothing when the document’s trailing blank line holds the last line', () => {
		const doc = parse('a\n\n');
		keepOpenTail(doc, true, createSharingState(), defaultGrammarView);
		expect(serialize(doc)).toBe('a\n\n');
	});
});
