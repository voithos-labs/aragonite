// A keystroke written in place runs inside the commit frame: a throw rolls the tree back and
// reports it, and the `edit` it announces fires inside the commit bracket.
// Miss-analysis: every rollback test drove a structural commit; the in-place keystroke had none.
import { describe, it, expect, afterEach } from 'vitest';
import { serialize } from '#lib/core/serializer.js';
import type { CstNode } from '#lib/core/nodes.js';
import type { EditorError } from '#lib/editor-events.js';
import { isCommitInProgress } from '#lib/commit-scope.js';
import { augmentBuiltin, tryGetBlockKindDescriptor } from '#lib/schema/block-kind-descriptor.js';
import { makeNestedHarness, makeTopHarness } from '#lib/test/harness/editor-actions.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';

const originalQuoteRebuild = tryGetBlockKindDescriptor('blockquote')!.rebuildRaw!;
afterEach(() => {
	augmentBuiltin('blockquote', { container: { rebuildRaw: originalQuoteRebuild } });
});

function throwOnQuoteRebuild(): void {
	augmentBuiltin('blockquote', {
		container: {
			rebuildRaw: () => {
				throw new Error('plugin rebuildRaw blew up');
			}
		}
	});
}

function quoteHarness(source = '> ab\n') {
	const harness = makeNestedHarness(source, { index: 0 });
	const errors: EditorError[] = [];
	harness.events.on('error', (e) => errors.push(e));
	let edits = 0;
	harness.events.on('edit', () => edits++);
	return { ...harness, errors, edits: () => edits };
}

/** A same-kind keystroke inside the quote, which takes the in-place route. */
function typeX(h: ReturnType<typeof quoteHarness>): Promise<boolean> {
	return h.bundle.blockEdit.updateBlockContent(0, 'abx\n', 'authored', 'join-typing', 2, 3);
}

describe('a keystroke whose ancestor rebuild throws', () => {
	it('rolls the tree back, reports the throw and announces no edit', async () => {
		const h = quoteHarness();
		const version = h.contentVersion();
		throwOnQuoteRebuild();

		await expect(typeX(h)).rejects.toThrow('plugin rebuildRaw blew up');

		expect(serialize(h.deps.doc)).toBe('> ab\n');
		expect((h.getNode().children![0] as CstNode).raw).toBe('ab\n');
		expect(h.errors).toHaveLength(1);
		expect(h.errors[0].origin).toBe('commit');
		expect(h.errors[0].context?.path).toEqual([0, 0]);
		expect(h.edits()).toBe(0);
		expect(h.contentVersion()).toBe(version);
	});

	// Indented text written on the blank line makes the list above absorb it, before the rebuild throws.
	const MERGES = '> - a\n>\n>\n> zz\n';

	it('puts back the blocks its fix-up merged', async () => {
		const h = quoteHarness(MERGES);
		const blocks = () => h.getNode().children!.map((c) => [c.kind, c.leadingTrivia, c.raw]);
		const before = blocks();
		throwOnQuoteRebuild();

		await expect(
			h.bundle.blockEdit.updateBlockContent(1, '  b\n', 'authored', 'join-typing', 0)
		).rejects.toThrow('plugin rebuildRaw blew up');

		expect(serialize(h.deps.doc)).toBe(MERGES);
		expect(blocks()).toEqual(before);
	});

	it('takes back the undo entry its own typing push opened', async () => {
		const h = quoteHarness();
		const before = h.deps.undoManager.getStacks().undo.length;
		throwOnQuoteRebuild();

		await expect(typeX(h)).rejects.toThrow();

		expect(h.deps.undoManager.getStacks().undo).toHaveLength(before);
	});

	it('leaves the next keystroke free to write once the rebuild stops throwing', async () => {
		const h = quoteHarness();
		throwOnQuoteRebuild();
		await expect(typeX(h)).rejects.toThrow();
		augmentBuiltin('blockquote', { container: { rebuildRaw: originalQuoteRebuild } });

		await typeX(h);

		expect(serialize(h.deps.doc)).toBe('> abx\n');
		expect(h.deps.undoManager.getStacks().undo).toHaveLength(1);
	});
});

describe('a keystroke written in place announces its edit inside the commit bracket', () => {
	it('at the top level', async () => {
		const h = makeTopHarness('ab\n');
		const seen: boolean[] = [];
		h.events.on('edit', () => seen.push(isCommitInProgress()));

		await h.actions.updateBlockContent(0, 'abx\n', 'authored', 'join-typing', 2, 3);

		expect(seen).toEqual([true]);
	});

	it('inside a container', async () => {
		const h = quoteHarness();
		const seen: boolean[] = [];
		h.events.on('edit', () => seen.push(isCommitInProgress()));

		await typeX(h);

		expect(seen).toEqual([true]);
	});
});

describe('G1.151 a keystroke owns what it wrote', () => {
	it('fires when a copy the keystroke wrote through still counts as an undo entry’s', async () => {
		const h = quoteHarness();
		// An unstamped copy reads as shared: the copy-before-write left it to the snapshot.
		h.deps.sharing.stamp = () => {};

		await typeX(h);

		expect(takeDevWarns().map((w) => w.tag)).toContain('invariant:written-unshared');
	});

	it('stays silent on an ordinary keystroke', async () => {
		const h = quoteHarness();

		await typeX(h);

		expect(takeDevWarns()).toEqual([]);
	});
});
