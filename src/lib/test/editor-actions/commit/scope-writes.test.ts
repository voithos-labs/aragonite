import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { assignIds } from '#lib/block-id.js';
import { createSharingState, type SharingState } from '#lib/tree-operations/sharing.js';
import type { CstNode, Document } from '#lib/core/nodes.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { documentBody } from '#lib/tree-operations/node-primitives.js';
import { createScopeWriter, type ScopeWriter } from '#lib/editor-actions/commit/scope-writes.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';

// `createBlockListState` backfills only an absent `childIds` array, never a short one, so
// a hand-rolled splice at depth desyncs the keyed-each source permanently.
function quoteWithIds(source: string): CstNode {
	const quote = parse(source).children[0];
	quote.childIds = assignIds(quote.children!);
	return quote;
}

/** Nothing marked, then a generation bump: every existing node reads as snapshot-shared. */
function sharedEverything() {
	const sharing = createSharingState();
	sharing.markSnapshotTaken();
	return sharing;
}

/** The document scope's splice of the list at `path`'s parent, at `path`'s last index. */
function spliceAt(doc: Document, path: number[], add: CstNode[], sharing: SharingState): void {
	const writer = createScopeWriter(documentBody(doc), sharing, defaultGrammarView, '\n');
	writer.splice(path.slice(0, -1), path[path.length - 1], 1, add);
}

describe('a commit scope splice that removes a block', () => {
	it('keeps childIds in lockstep with the container it deletes from', () => {
		const doc = parse('> a\n>\n> b\n');
		const quote = doc.children[0];
		quote.childIds = assignIds(quote.children!);
		const survivingId = quote.childIds[1];

		spliceAt(doc, [0, 0], [], sharedEverything());

		const written = doc.children[0];
		expect(written.children).toHaveLength(1);
		expect(written.childIds).toEqual([survivingId]);
		// The quote is an undo entry's too, so the splice landed in its copy.
		expect(written).not.toBe(quote);
		expect(quote.children).toHaveLength(2);
	});

	it('splices a top-level child whose parent carries no childIds', () => {
		const doc = parse('a\n\nb\n');
		spliceAt(doc, [0], [], sharedEverything());
		expect(doc.children).toHaveLength(1);
		expect(doc.children[0].raw).toBe('b\n');
	});

	// The fix-up hands the vacated separator to the block that takes the position, a node the
	// snapshot still points at, so `sharing` is required and the heir is copied before the write.
	it('copies the heir before handing it the vacated separator, never writing the shared node', () => {
		const doc = parse('a\n\n# h\npara\n');
		const heirBefore = doc.children[2];
		expect(heirBefore.leadingTrivia).toBe('');

		spliceAt(doc, [1], [], sharedEverything());

		expect(doc.children[1].leadingTrivia).toBe('\n');
		expect(doc.children[1]).not.toBe(heirBefore);
		expect(heirBefore.leadingTrivia).toBe('');
	});
});

describe('a commit scope splice that replaces a block', () => {
	it('keeps childIds in lockstep when a replacement changes the child count', () => {
		const doc = parse('> a\n');
		const quote = doc.children[0];
		quote.childIds = assignIds(quote.children!);
		const replacement = parse('x\n\ny\n').children;

		spliceAt(doc, [0, 0], replacement, sharedEverything());

		expect(doc.children[0].children).toHaveLength(2);
		expect(doc.children[0].childIds).toHaveLength(2);
	});

	it('leaves the trailing siblings ids untouched', () => {
		const quote = quoteWithIds('> a\n>\n> b\n');
		const doc = { kind: 'document' as const, prefix: '', children: [quote], suffix: '' };
		const trailingId = quote.childIds![1];

		spliceAt(doc, [0, 0], parse('x\n').children, sharedEverything());

		expect(doc.children[0].childIds).toHaveLength(2);
		expect(doc.children[0].childIds![1]).toBe(trailingId);
	});
});

describe('a commit scope write on a path not below the scope', () => {
	it.each([
		{ name: 'own', write: (w: ScopeWriter) => w.own([0, 5]) },
		{ name: 'splice', write: (w: ScopeWriter) => w.splice([3], 0, 1, []) },
		{ name: 'writeLeaf', write: (w: ScopeWriter) => w.writeLeaf([0, 5], 'x') }
	])('$name throws before writing anything', ({ write }) => {
		const doc = parse('> a\n');
		const before = doc.children[0];
		const writer = createScopeWriter(
			documentBody(doc),
			sharedEverything(),
			defaultGrammarView,
			'\n'
		);

		expect(() => write(writer)).toThrow(/commit scope: no node at/);

		expect(takeDevWarns().map((w) => w.tag)).toEqual(['invariant:unshare-path-in-range']);
		expect(writer.owned).toEqual([]);
		expect(before.raw).toBe('> a\n');
	});
});
