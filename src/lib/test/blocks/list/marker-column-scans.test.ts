// @vitest-environment jsdom
// G4.215: a list's marker column reads no item at load, where the parse counts the markers, and on
// a key at most the item the key rewrote beyond the pass its rebuild already makes over the items.
// Miss-analysis: the column's cost probes counted its scans, never its reads of the item ids,
// which every undo snapshot handed it afresh, so a paused key read every id and no row counted it.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, onTestFinished } from 'vitest';
import { tick } from 'svelte';
import { UNDO_DEBOUNCE_MS } from '#lib/editor-actions/commit/text-batch.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	pressKeyAt,
	surfaceAt,
	typeInto,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';

const ITEMS = 400;
const LONG_LIST = Array.from({ length: ITEMS }, (_, i) => `${i + 1}. item\n`).join('');

beforeAll(installLayoutStubs);
beforeEach(() => {
	resetPerfInstruments();
	enablePerfInstruments();
});
afterEach(async () => {
	disablePerfInstruments();
	await destroyMountedEditors();
});

const columnOf = (editor: MountedEditor) =>
	editor.target
		.querySelector<HTMLElement>('.list-block')!
		.style.getPropertyValue('--md-list-column');

async function typeInItem(editor: MountedEditor, item: number, text: string): Promise<void> {
	typeInto(surfaceAt(editor, [0, item, 0]), text);
	await tick();
}

/** The marker reads `gesture` costs beyond the items its rebuild joined in full. */
async function readsBeyondRebuild(gesture: () => Promise<void>): Promise<number> {
	resetPerfInstruments();
	await gesture();
	const { listMarkerReads, joinedChildReads } = perfSnapshot();
	return listMarkerReads - joinedChildReads;
}

describe('the cost of a list’s marker column', () => {
	it('reads no item at load, where the parse counts the markers it reads', async () => {
		const editor = mountEditor({ source: LONG_LIST, presentationMode: 'live' });
		await tick();

		expect(perfSnapshot().listMarkerReads).toBe(0);
		expect(columnOf(editor)).toBe('calc(5 * 1ch)');
	});

	it('reads at most the rewritten item on a key, the first, a paused one or one in a burst', async () => {
		// The typing pause is a wall-clock timer, so the test moves the clock instead of waiting.
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		onTestFinished(() => void vi.useRealTimers());
		const editor = mountEditor({ source: LONG_LIST, presentationMode: 'live' });
		await tick();
		const reads: Record<string, number> = {};
		let text = 'item';
		const key = () => typeInItem(editor, 3, (text += 'x'));

		reads.first = await readsBeyondRebuild(key);
		for (const n of [1, 2]) {
			// Past the pause, the key opens a new undo entry, which copies the edited path.
			vi.advanceTimersByTime(UNDO_DEBOUNCE_MS);
			reads[`paused ${n}`] = await readsBeyondRebuild(key);
		}
		reads.burst = await readsBeyondRebuild(key);

		expect(editor.source()).toContain('4. itemxxxx\n');
		expect(reads).toEqual({ first: 1, 'paused 1': 1, 'paused 2': 1, burst: 1 });
	});

	it('reads at most the rewritten item when a marker changes in place or an item comes', async () => {
		const editor = mountEditor({ source: LONG_LIST, presentationMode: 'source' });
		await tick();
		await typeInItem(editor, 3, 'item!');

		const marker = await readsBeyondRebuild(() => typeInItem(editor, 3, '[ ] item!'));
		const enter = await readsBeyondRebuild(async () => {
			await pressKeyAt(editor, [0, 3, 0], 5, { key: 'Enter' });
			await tick();
		});

		expect(editor.source()).toContain('4. [ ] item!\n5. [ ] \n');
		expect({ marker, enter }).toEqual({ marker: 1, enter: 0 });
	});
});

describe('the list’s marker column', () => {
	it('widens when an item’s marker changes in place', async () => {
		const editor = mountEditor({ source: '- a\n- b\n', presentationMode: 'live' });
		await tick();
		const before = columnOf(editor);

		await typeInItem(editor, 0, '[ ] a');

		expect(editor.source()).toBe('- [ ] a\n- b\n');
		expect(columnOf(editor)).not.toBe(before);
	});

	it('narrows again when an undo takes the marker change back, with no recount', async () => {
		const editor = mountEditor({ source: '- a\n- b\n', presentationMode: 'live' });
		await tick();
		const before = columnOf(editor);
		await typeInItem(editor, 0, '[ ] a');

		// The undo entry's list carries its counts, so the restore reads no item for them.
		const reads = await readsBeyondRebuild(async () => {
			await pressKeyAt(editor, [0, 0, 0], 0, { key: 'z', ctrlKey: true });
			await editor.settle();
		});

		expect(editor.source()).toBe('- a\n- b\n');
		expect(columnOf(editor)).toBe(before);
		expect(reads).toBe(0);
	});

	it('comes back when an undo takes back a to-do, from counts the edit left alone', async () => {
		const editor = mountEditor({ source: '- a\n- [ ] b\n', presentationMode: 'live' });
		await tick();
		const before = columnOf(editor);
		// After a first key, which joins every item once, the undo entry and the edited list share
		// the counts the to-do replaces.
		await typeInItem(editor, 0, 'a!');
		await typeInItem(editor, 0, '[ ] a!');
		const widened = columnOf(editor);

		await pressKeyAt(editor, [0, 0, 0], 0, { key: 'z', ctrlKey: true });
		await editor.settle();

		expect(editor.source()).toBe('- a\n- [ ] b\n');
		expect(widened).not.toBe(before);
		expect(columnOf(editor)).toBe(before);
	});

	it('widens when an item with a wider marker comes', async () => {
		const editor = mountEditor({ source: '8. a\n9. b\n', presentationMode: 'live' });
		await tick();
		const before = columnOf(editor);

		await pressKeyAt(editor, [0, 1, 0], 1, { key: 'Enter' });
		await tick();

		expect(editor.source()).toBe('8. a\n9. b\n10. \n');
		expect(columnOf(editor)).not.toBe(before);
	});

	it('changes when the mode starts drawing to-do boxes', async () => {
		const editor = mountEditor({ source: '- [ ] a\n- b\n', presentationMode: 'source' });
		await tick();
		const before = columnOf(editor);

		editor.props.presentationMode = 'live';
		await editor.settle();

		expect(columnOf(editor)).not.toBe(before);
	});
});
