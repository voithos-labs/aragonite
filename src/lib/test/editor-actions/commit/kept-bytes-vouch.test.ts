// G1.219: bytes read off the kept record leave it through a vouch. With the record left wrong by a
// write that named no block (a block written through its undo snapshot, as long as it was), a
// range read over the block reads again from the tree, a splice whose reading took the block is
// refused and the next one lands, and a save reads the tree. Each tells the `error` channel.
// Miss-analysis: nothing in production compared the kept record with the tree, so a wrong run was
// served until the block count changed.
import { describe, expect, it } from 'vitest';
import { docPathFrom } from '#lib/core/coordinate-spaces.js';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { createKeptStarts } from '#lib/editor-actions/commit/kept-starts.js';
import type { EditorError } from '#lib/editor-events.js';
import { blockRangeClipboard } from '#lib/selection/range-clipboard.js';
import { makeTopHarness } from '#lib/test/harness/editor-actions.js';
import { allowDevWarns } from '../../support/warn-gate';

const N = 12;
const SOURCE = Array.from({ length: N }, (_, i) => `line ${i}\n`).join('\n');
const snapshot = { path: docPathFrom([2]), offset: 0 };
// The stale write trips the snapshot digest too, at its own commit and at each one after.
const FIXTURE_WARNS = ['invariant:kept-starts-current', 'invariant:snapshot-integrity'];

/** An editor whose measured record holds block 2's bytes from before a write no run named. */
async function staleAtBlockTwo() {
	const h = makeTopHarness(SOURCE);
	const errors: EditorError[] = [];
	h.events.on('error', (error) => errors.push(error));
	void h.deps.bytes.measured().starts.length;
	await h.controller.commitStructural({
		snapshot,
		mutate(children) {
			children[2].raw = 'LINE 2\n';
			return { op: 'noop' };
		},
		op: { kind: 'input', eventPath: snapshot.path }
	});
	allowDevWarns(FIXTURE_WARNS);
	expect(errors).toEqual([]);
	return { ...h, errors };
}

/** One letter written over the first letter of block `block`. */
const letterIn = (h: Awaited<ReturnType<typeof staleAtBlockTwo>>, block: number) => {
	const at = serialize(h.deps.doc).toLowerCase().indexOf(`line ${block}\n`);
	return h.controller.commitSource({
		changes: [{ from: at, to: at + 1, insert: 'Q' }],
		caret: 'keep',
		op: { kind: 'input' },
		snapshot
	});
};

describe('G1.219 kept bytes leave the record through a vouch', () => {
	it.each([
		['the stale block', 2],
		['the block below it, which the reading starts above', 3]
	])('a splice whose reading took %s is refused, and the next lands', async (_, block) => {
		const h = await staleAtBlockTwo();
		const before = serialize(h.deps.doc);

		expect(await letterIn(h, block)).toBe(false);
		expect(serialize(h.deps.doc)).toBe(before);
		expect(h.errors).toHaveLength(1);
		expect(h.deps.starts.isMeasured()).toBe(false);

		expect(await letterIn(h, block)).toBe(true);
		expect(serialize(h.deps.doc).toLowerCase()).toContain(`qine ${block}\n`);
		expect(h.errors).toHaveLength(1);
		allowDevWarns(FIXTURE_WARNS);
	});

	it('a splice far from the stale block lands', async () => {
		const h = await staleAtBlockTwo();
		expect(await letterIn(h, 9)).toBe(true);
		expect(h.errors).toEqual([]);
		allowDevWarns(FIXTURE_WARNS);
	});

	it('a copy over the stale block reads again and takes the tree’s bytes', async () => {
		const h = await staleAtBlockTwo();
		const copy = blockRangeClipboard(h.deps.bytes, [2], { start: 0, end: 6 }, h.deps.reading);
		expect(copy?.text).toBe('LINE 2');
		expect(h.errors).toHaveLength(1);
		allowDevWarns(FIXTURE_WARNS);
	});

	it('a save reads the tree, and says so where the record held other bytes', () => {
		const doc = parse(SOURCE);
		const reported: Error[] = [];
		const starts = createKeptStarts(
			() => doc,
			() => {},
			(error) => reported.push(error)
		);
		void starts.read().starts.length;
		doc.children[2].raw = 'LINE 2\n';

		expect(starts.saved()).toBe(serialize(doc));
		expect(reported).toHaveLength(1);
		expect(starts.isMeasured()).toBe(false);
		expect(starts.saved()).toBe(serialize(doc));
		expect(reported).toHaveLength(1);
		allowDevWarns(['invariant:kept-starts-current']);
	});
});
