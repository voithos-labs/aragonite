// @vitest-environment jsdom
// Code a write runs before it is announced (a plugin's `mutate`, a block's own hook) can read the
// document and start a write of its own. The text it is handed and the positions it is handed must
// then both describe the tree as it stands, in a production build too.
// Miss-analysis: every route row writes from outside a write, and the headless harness serializes
// on every read, so no row paired the editor's kept text with a tree a write had already changed.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { configureEditorEnv, resetEditorEnv } from '@voithos-labs/aragonite/dev-checks';
import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';
import type { DraftResult } from '#lib/schema/drafts.js';
import { pressKey } from '#lib/test/harness/settle.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { takeDevWarns } from '../../support/warn-gate';

type Mounted = MountedEditor<EditorTestSurface>;

beforeAll(installLayoutStubs);
afterEach(async () => {
	resetEditorEnv();
	await destroyMountedEditors();
});

const SOURCE = Array.from({ length: 12 }, (_, i) => `line ${i}\n`).join('\n');

/** An editor holding a range from block 3 into block 5, its text and positions already asked for. */
async function mountedHoldingRange(): Promise<Mounted> {
	const m = mountEditor<EditorTestSurface>({ source: SOURCE });
	await m.settle();
	m.instance.__test.byteOf([3], 0);
	m.source();
	await m.instance.setSelection({
		anchor: { path: [3], offset: 2 },
		focus: { path: [5], offset: 2 }
	});
	await m.settle();
	return m;
}

/** Runs `inside` once from within the next write: the removal clears the caret after it changes
 *  the tree and before it announces. */
function insideNextWrite(m: Mounted, inside: () => void): void {
	const writer = m.instance.__test.getCaretWriter();
	const clear = writer.clear;
	writer.clear = () => {
		writer.clear = clear;
		clear();
		inside();
	};
}

const backspace = async (m: Mounted) => {
	await pressKey(surfaceAt(m, [3]), { key: 'Backspace' });
	await m.settle();
};

describe.each([
	{ build: 'a dev build', isDev: true },
	{ build: 'a production build', isDev: false }
])('inside a write that has changed the tree, in $build', ({ isDev }) => {
	it('the text read is the tree as it stands', async () => {
		const alone = await mountedHoldingRange();
		await backspace(alone);
		const removed = alone.source();
		expect(removed).not.toBe(SOURCE);

		const m = await mountedHoldingRange();
		let read = '';
		insideNextWrite(m, () => (read = m.instance.getSource()));
		configureEditorEnv({ isDev });
		await backspace(m);

		expect(read).toBe(removed);
		expect(takeDevWarns()).toEqual([]);
	});

	it('a draft committed there lands where its range names', async () => {
		const alone = await mountedHoldingRange();
		await backspace(alone);
		const removed = alone.source();

		const m = await mountedHoldingRange();
		let landed: Promise<DraftResult> | null = null;
		insideNextWrite(m, () => {
			const at = m.instance.getSource().indexOf('line 8');
			landed = m.instance.edit().replace({ from: at, to: at }, 'Z').commit();
		});
		configureEditorEnv({ isDev });
		await backspace(m);
		await landed;
		await m.settle();

		expect(m.source()).toBe(removed.replace('line 8', 'Zline 8'));
		// A dev build still fails the write: it read positions before the outer write announced.
		const tags = new Set(takeDevWarns().map((warn) => warn.tag));
		expect([...tags]).toEqual(isDev ? ['invariant:kept-starts-current'] : []);
	});
});
