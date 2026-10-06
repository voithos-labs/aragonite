// @vitest-environment jsdom
// Where a block can't measure its lines (jsdom measures nothing), ArrowUp and ArrowDown decide
// "first or last line" from an offset, and over a selection that offset is the selection's focus.
// Miss-analysis: the fallback rows all pressed at a caret, where the selection's start and its
// focus are the same offset.
import { it, expect, beforeAll, afterEach } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	selectRange,
	surfaceAt
} from '$lib/test/harness/mount-editor.svelte';
import { pressKey } from '$lib/test/harness/settle';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

it('ArrowDown from a selection ending at the block end moves to the next block', async () => {
	const mounted = mountEditor({ source: 'abc\n\ndef\n' });
	const el = surfaceAt(mounted, [0]);
	selectRange(el, 1, 3);

	await pressKey(el, { key: 'ArrowDown' });

	expect(mounted.instance.getSelection()?.focus.path).toEqual([1]);
});
