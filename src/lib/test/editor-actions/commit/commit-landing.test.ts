// A commit reads its landing after the tick and puts the caret there through the editor's one
// landing: a discarded no-op still lands, a reading-mode refusal lands nothing, and a landing that
// waited across an undo places nothing.
import { describe, expect, it, vi } from 'vitest';
import type { StructuralChange } from '$lib/tree-operations/structural-change';
import type { BlockComponent } from '$lib/block-component';
import { docPathFrom } from '$lib/cursor/coordinate-spaces';
import { createHistoryActions } from '$lib/editor-actions/commit/history';
import { READING_WRITE_TAG } from '$lib/editor-actions/commit/reading-write-gate';
import { refSlotsOver } from '$lib/reactivity/publish-ref.svelte';
import { createCaretLanding } from '$lib/selection/caret-landing';
import { asDocPath } from '$lib/selection/path-math';
import { makeTopHarness, stubBlockComponent } from '../../harness/editor-actions';
import { fixtureReading } from '../../harness/fixture-grammar';
import { takeDevWarns } from '../../support/warn-gate';

const deleteSecond = (children: unknown[]): StructuralChange => {
	children.splice(1, 1);
	return { op: 'delete', at: 1, count: 1 };
};

const landAtFirst = () => ({ path: docPathFrom([0]), offset: 1 });

describe('when a commit lands its caret', () => {
	it('lands the position its landing returns, read after the commit', async () => {
		const h = makeTopHarness('ab\n\nc\n\nd\n');
		await h.controller.commitStructural({
			snapshot: { path: asDocPath([0]), offset: 0 },
			mutate: deleteSecond,
			landing: () => ({ path: docPathFrom([h.deps.doc.children.length - 1]), offset: 0 })
		});
		expect(h.landings).toEqual([{ leafPath: [1], offset: 0 }]);
	});

	it('still lands a discarded no-op, since a refused edit still moves across the boundary', async () => {
		const h = makeTopHarness('ab\n\nc\n');
		const wrote = await h.controller.commitStructural({
			snapshot: { path: asDocPath([0]), offset: 0 },
			mutate: () => ({ op: 'noop' }),
			discardIfNoop: true,
			landing: landAtFirst
		});
		expect(wrote).toBe(false);
		expect(h.landings).toEqual([{ leafPath: [0], offset: 1 }]);
	});

	it('lands nothing when reading mode refused the write', async () => {
		const h = makeTopHarness('ab\n\nc\n', { reading: fixtureReading({}, 'reading') });
		let read = false;
		await h.controller.commitStructural({
			snapshot: { path: asDocPath([0]), offset: 0 },
			mutate: deleteSecond,
			landing: () => {
				read = true;
				return landAtFirst();
			}
		});
		expect(takeDevWarns().map((w) => w.tag)).toEqual([READING_WRITE_TAG]);
		expect([read, h.landings]).toEqual([false, []]);
	});

	// Miss-analysis: only the paste landing checked for a history swap, and no test undid while
	// any other commit's caret waited for its block to mount.
	it('places nothing when an undo finishes while the landing waits for its block to mount', async () => {
		const h = makeTopHarness('ab\n\nc\n\nd\n');
		// Nothing is mounted until the landing asks, and each mount waits for the test.
		const refs: (BlockComponent | undefined)[] = [];
		const placed: number[] = [];
		let waiting!: () => void;
		const asked = new Promise<void>((resolve) => (waiting = resolve));
		let mount!: () => void;
		const mounted = new Promise<void>((resolve) => (mount = resolve));
		const landing = createCaretLanding({
			getDoc: () => h.deps.doc,
			root: {
				count: () => h.deps.doc.children.length,
				refs: refSlotsOver(refs),
				windowing: {
					async revealChild(index) {
						waiting();
						await mounted;
						refs[index] = stubBlockComponent({ focus: () => void placed.push(index) });
					},
					isInWindow: () => true
				}
			},
			selectionState: h.deps.selectionState,
			caretMemory: h.deps.caretMemory,
			getBlockElByPath: () => null,
			scroll: null
		});
		Object.defineProperty(h.deps, 'caretLanding', { value: landing });
		const history = createHistoryActions(h.deps, h.controller);

		const committed = h.controller.commitStructural({
			snapshot: { path: asDocPath([0]), offset: 0 },
			mutate: deleteSecond,
			landing: () => ({ path: docPathFrom([1]), offset: 0 })
		});
		await asked;
		await history.requestUndo();
		mount();
		await committed;

		expect(placed).toEqual([]);
	});

	it('places nothing when an undo lands between the commit and the read of its landing', async () => {
		const h = makeTopHarness('ab\n\nc\n\nd\n');
		const history = createHistoryActions(h.deps, h.controller);
		const committed = h.controller.commitStructural({
			snapshot: { path: asDocPath([0]), offset: 0 },
			mutate: deleteSecond,
			landing: () => ({ path: docPathFrom([1]), offset: 0 })
		});
		// The undo swaps the tree before its first await, while the commit waits for its tick.
		const undone = history.requestUndo();
		await committed;
		await undone;

		const focused = h.getBlockRefs().flatMap((ref) => (ref ? vi.mocked(ref.focus).mock.calls : []));
		expect(focused).toEqual([]);
	});
});
