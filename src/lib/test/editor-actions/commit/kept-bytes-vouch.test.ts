// G1.219: bytes read off the kept record leave it through a vouch. With the record left wrong by a
// write that named no block (a block written through its undo snapshot, as long as it was), a
// range read over the block reads again from the tree, a splice whose reading took the block is
// refused and the next one lands, and a save reads the tree. Each tells the `error` channel.
// Miss-analysis: nothing in production compared the kept record with the tree, so a wrong run was
// served until the block count changed.
// Miss-analysis, the grown block: every row kept the stale block's length, so a byte worked out
// from an offset in the block still fell in it, and the vouch never had to cover another block.
import { describe, expect, it } from 'vitest';
import { configureEditorEnv, resetEditorEnv } from '@voithos-labs/aragonite/dev-checks';
import { docPathFrom } from '#lib/core/coordinate-spaces.js';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { createKeptStarts } from '#lib/editor-actions/commit/kept-starts.js';
import type { EditorError } from '#lib/editor-events.js';
import { coverRange, rangeCoverage } from '#lib/selection/range-coverage.js';
import { blockRangeClipboard, rangeClipboard } from '#lib/selection/range-clipboard.js';
import { draftRegistryOver } from '#lib/test/harness/drafts.js';
import { makeTopHarness } from '#lib/test/harness/editor-actions.js';
import { allowDevWarns } from '../../support/warn-gate';

const N = 12;
const SOURCE = Array.from({ length: N }, (_, i) => `line ${i}\n`).join('\n');
const snapshot = { path: docPathFrom([2]), offset: 0 };
// The stale write trips the snapshot digest too, at its own commit and at each one after.
const FIXTURE_WARNS = ['invariant:kept-starts-current', 'invariant:snapshot-integrity'];

// Longer than the three blocks below it, so an offset in it lies past them in the kept record.
const GROWN = 'LINE 2 grown well past the blocks that stand below it\n';

/** An editor whose measured record holds block 2's bytes from before a write no run named. */
async function staleAtBlockTwo(raw = 'LINE 2\n') {
	const h = makeTopHarness(SOURCE);
	const errors: EditorError[] = [];
	h.events.on('error', (error) => errors.push(error));
	void h.deps.bytes.measured().starts.length;
	await h.controller.commitStructural({
		snapshot,
		mutate(children) {
			children[2].raw = raw;
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

	it.each([
		['past the length the record kept for it', 30, 40],
		['from the byte the record ends it at', 7, 12]
	])(
		'a copy in a block grown with no run named, %s, takes the tree’s bytes',
		async (_, from, to) => {
			const h = await staleAtBlockTwo(GROWN);
			const range = { start: from, end: to };
			const copy = blockRangeClipboard(h.deps.bytes, [2], range, h.deps.reading);
			expect(copy?.text).toBe(GROWN.slice(from, to));
			expect(h.errors).toHaveLength(1);
			allowDevWarns(FIXTURE_WARNS);
		}
	);

	it('a copy from inside the grown block to a block below it takes the tree’s bytes', async () => {
		const h = await staleAtBlockTwo(GROWN);
		const { doc } = h.deps;
		const ends = coverRange(doc, { path: [2], offset: 30 }, { path: [4], offset: 4 });
		const copy = rangeClipboard(h.deps.bytes, rangeCoverage(doc, ends), h.deps.reading);
		expect(copy?.text).toBe(`${GROWN.slice(30)}\nline 3\n\nline`);
		expect(h.errors).toHaveLength(1);
		allowDevWarns(FIXTURE_WARNS);
	});

	it('a draft writing inside the grown block writes there, off a fresh read', async () => {
		const h = await staleAtBlockTwo(GROWN);
		const at = serialize(h.deps.doc).indexOf(GROWN) + 30;
		const draft = draftRegistryOver(h).edit();
		expect(await draft.replace({ from: at, to: at + 1 }, 'Q').commit()).toEqual({ ok: true });
		expect(serialize(h.deps.doc)).toContain(`${GROWN.slice(0, 30)}Q${GROWN.slice(31)}`);
		expect(serialize(h.deps.doc)).toContain('line 5\n\nline 6\n');
		expect(h.errors).toHaveLength(1);
		allowDevWarns(FIXTURE_WARNS);
	});

	// A production build runs no dev check, so the vouch is the only thing that can tell.
	it('with dev checks off, a refusal and a copy each still tell the `error` channel', async () => {
		configureEditorEnv({ isDev: false });
		try {
			const h = await staleAtBlockTwo();
			const before = serialize(h.deps.doc);
			expect(await letterIn(h, 2)).toBe(false);
			expect(serialize(h.deps.doc)).toBe(before);
			expect(h.errors).toHaveLength(1);

			const again = await staleAtBlockTwo();
			const copy = blockRangeClipboard(
				again.deps.bytes,
				[2],
				{ start: 0, end: 6 },
				again.deps.reading
			);
			expect(copy?.text).toBe('LINE 2');
			expect(again.errors).toHaveLength(1);

			const grown = await staleAtBlockTwo(GROWN);
			const past = { start: 30, end: 40 };
			const taken = blockRangeClipboard(grown.deps.bytes, [2], past, grown.deps.reading);
			expect(taken?.text).toBe(GROWN.slice(30, 40));
			expect(grown.errors).toHaveLength(1);
		} finally {
			resetEditorEnv();
		}
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

	// Miss-analysis: a position read forgot a record the tree had left by a block, but the text
	// was served as joined before it, and the vouch after it had no record left to compare.
	it('a block added with no write announced is in the text a gesture reads, and is reported', () => {
		const doc = parse(SOURCE);
		const reported: Error[] = [];
		const starts = createKeptStarts(
			() => doc,
			() => {},
			(error) => reported.push(error)
		);
		void starts.read().starts.length;
		expect(starts.source()).toBe(serialize(doc));
		doc.children.push({ ...doc.children[0], raw: 'added\n' });

		expect(starts.source()).toBe(serialize(doc));
		expect(reported).toHaveLength(1);
		expect(starts.vouch(0, doc.children.length - 1)).toBe(true);
		allowDevWarns(['invariant:kept-starts-current']);
	});
});
