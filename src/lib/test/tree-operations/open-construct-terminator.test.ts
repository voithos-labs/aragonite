import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { updateNodeContent } from '$lib/tree-operations/node-ops';
import { reorderChildrenWithTrivia } from '$lib/tree-operations/reorder';
import { createSharingState } from '$lib/tree-operations/sharing';
import { rebuildContainerRaw } from '$lib/schema/container-raw';
import { describeConvergence } from '$lib/test/harness/parse-converged';

// GH #180: a write leaving an unterminated absorb-to-EOF construct made the seam settle converge
// the live tree to the reload's reading, which is the whole rest of the document as the
// construct's body. The sink closes the construct instead, so the neighbours stand.
// Miss-analysis: the kind-change absorb's pins drew prose demotions only — every one wrote a kind
// whose bytes terminate on their own line, so no pin ever asked what a construct that eats forward
// does to the blocks below it.

describe('a write closes the construct its own bytes leave open (GH #180)', () => {
	it('a typed fence closes over an empty body and the neighbours stand', () => {
		const doc = parse('x\n\nalpha beta\n\ngamma delta\n');

		const settled = updateNodeContent(doc, 0, '```\n');

		expect(doc.children.map((c) => [c.kind, c.raw])).toEqual([
			['fencedCode', '```\n```\n'],
			['paragraph', 'alpha beta\n'],
			['paragraph', 'gamma delta\n']
		]);
		expect(serialize(doc)).toBe('```\n```\n\nalpha beta\n\ngamma delta\n');
		expect(describeConvergence(doc)).toBeNull();
		expect(settled.change).toEqual({
			op: 'replace',
			at: 0,
			count: 1,
			newCount: 1,
			idMap: { 0: 0 }
		});
		// The minted terminator lands past the written text, so the caret's offset is untouched.
		expect(settled.textStart).toBe(0);
	});

	// Blank runs are fence content, so a separated neighbour is no safer than a tight one.
	it('holds against a TIGHT follower too', () => {
		const doc = parse('# h\ntext\n');
		expect(doc.children.map((c) => c.kind)).toEqual(['heading', 'paragraph']);

		updateNodeContent(doc, 0, '```\n');

		expect(doc.children.map((c) => [c.kind, c.raw])).toEqual([
			['fencedCode', '```\n```\n'],
			['paragraph', 'text\n']
		]);
		expect(describeConvergence(doc)).toBeNull();
	});

	it('sizes the terminator to the opener the write actually typed', () => {
		const doc = parse('x\n\ntail\n');

		updateNodeContent(doc, 0, '  ~~~~js\n');

		expect(doc.children.map((c) => c.raw)).toEqual(['  ~~~~js\n  ~~~~\n', 'tail\n']);
		expect(describeConvergence(doc)).toBeNull();
	});

	// A multi-block write leaves the construct in its LAST block, which is the one that meets
	// the follower.
	it('closes an open construct a multi-block write left at its tail', () => {
		const doc = parse('x\n\ntail\n');

		const settled = updateNodeContent(doc, 0, 'a\n\n```\n');

		expect(doc.children.map((c) => [c.kind, c.raw])).toEqual([
			['paragraph', 'a\n'],
			['fencedCode', '```\n```\n'],
			['paragraph', 'tail\n']
		]);
		expect(describeConvergence(doc)).toBeNull();
		expect(settled.change).toEqual({
			op: 'replace',
			at: 0,
			count: 1,
			newCount: 2,
			idMap: { 0: 0 }
		});
	});

	it('carries the written line ending into the terminator', () => {
		const doc = parse('x\r\n\r\ntail\r\n');

		updateNodeContent(doc, 0, '```\r\n');

		expect(doc.children.map((c) => c.raw)).toEqual(['```\r\n```\r\n', 'tail\r\n']);
		expect(describeConvergence(doc)).toBeNull();
	});

	// The container door writes marker-stripped body bytes, a different reading path than the
	// document's, so the body owes its own pin.
	it('closes inside a container body too', () => {
		const doc = parse('> a\n> # h\n> b\n');
		const quote = doc.children[0];

		updateNodeContent(
			{ children: quote.children!, ownerKind: quote.kind, owner: quote },
			1,
			'```\n'
		);
		rebuildContainerRaw(quote);

		expect(quote.children!.map((c) => [c.kind, c.raw])).toEqual([
			['paragraph', 'a\n'],
			['fencedCode', '```\n```\n'],
			['paragraph', 'b\n']
		]);
		expect(serialize(doc)).toBe('> a\n> ```\n> ```\n> b\n');
		expect(describeConvergence(doc)).toBeNull();
	});
});

describe('the mint declines where nothing is at stake (GH #180)', () => {
	// An authored open fence at the tail absorbs nothing, and closing it would rewrite bytes the
	// user did not type — the exemption `schema/fenced-code-raw.ts` already declares.
	it('leaves a tail fence open, with no follower to swallow', () => {
		const doc = parse('x\n\ntail\n');

		updateNodeContent(doc, 1, '```\n');

		expect(doc.children.map((c) => [c.kind, c.raw])).toEqual([
			['paragraph', 'x\n'],
			['fencedCode', '```\n']
		]);
		expect(serialize(doc)).toBe('x\n\n```\n');
	});

	// Typing INSIDE an existing open fence is kind-stable, so the write never reaches the settle
	// and the user's own bytes stand.
	it('leaves a kind-stable write into an open fence alone', () => {
		const doc = parse('```\ncode\n');
		expect(doc.children.map((c) => c.kind)).toEqual(['fencedCode']);

		const settled = updateNodeContent(doc, 0, '```\ncodex\n');

		expect(doc.children.map((c) => c.raw)).toEqual(['```\ncodex\n']);
		expect(settled.change).toEqual({ op: 'noop' });
	});

	it('leaves a write whose construct terminates on its own bytes alone', () => {
		const doc = parse('x\n\ntail\n');

		updateNodeContent(doc, 0, '# h\n');

		expect(doc.children.map((c) => [c.kind, c.raw])).toEqual([
			['heading', '# h\n'],
			['paragraph', 'tail\n']
		]);
	});
});

// The other side of the decision: the mint is the WRITE's, so a gesture that only exposes an open
// construct still folds. A reorder writes no bytes, and an open fence moved above prose reads as
// its body on reload — the absorb converges to that, and re-terminating here would rewrite bytes
// no keystroke produced.
describe('a gesture that writes no bytes still absorbs (GH #180)', () => {
	it('a reorder lifting an open fence above prose folds the way the reload reads it', () => {
		const doc = parse('a\n\n```\nx\n');
		expect(doc.children.map((c) => c.kind)).toEqual(['paragraph', 'fencedCode']);

		const settled = reorderChildrenWithTrivia(doc.children, 1, 0, createSharingState());

		expect(doc.children.map((c) => [c.kind, c.raw])).toEqual([['fencedCode', '```\nx\n\na\n']]);
		expect(describeConvergence(doc)).toBeNull();
		expect(settled.change.op).toBe('replace');
	});
});
