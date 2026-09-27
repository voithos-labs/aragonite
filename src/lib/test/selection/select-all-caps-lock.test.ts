// @vitest-environment jsdom
// Two Mod+A presses select the whole document from every editable block, CapsLock on or off.
// CapsLock uppercases `e.key` without a Shift, so the key still means Mod+A.
// Miss-analysis: every select-all test pressed a lowercase `a`.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
	installLayoutStubs,
	mountEditor,
	surfaceAt,
	destroyMountedEditors
} from '$lib/test/harness/mount-editor.svelte';
import { pressKey } from '$lib/test/harness/settle';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

// A table's first editable element is its first cell, which carries no path attribute of its own.
const BLOCKS = [
	{ block: 'a paragraph', source: 'alpha\n\nomega\n', path: [0], last: [1] },
	{ block: 'a code block', source: '```\nalpha\n```\n\nomega\n', path: [0], last: [1] },
	{ block: 'a table cell', source: '| a | b |\n| - | - |\n\nomega\n', path: [0], last: [1] }
];

describe('two-stage Mod+A', () => {
	for (const { block, source, path, last } of BLOCKS) {
		for (const key of ['a', 'A']) {
			it(`the second press of key "${key}" in ${block} selects the whole document`, async () => {
				const mounted = mountEditor({ source });
				const el = surfaceAt(mounted, path);
				el.focus();

				await pressKey(el, { key, ctrlKey: true });
				await pressKey(el, { key, ctrlKey: true });

				expect(mounted.instance.getSelection()?.focus.path).toEqual(last);
			});
		}
	}

	// With the document already selected, a third keypress takes the live range's branch.
	it('a third press of key "A" keeps the whole document selected', async () => {
		const mounted = mountEditor({ source: 'alpha\n\nomega\n' });
		const el = surfaceAt(mounted, [0]);
		el.focus();
		for (let press = 0; press < 2; press++) await pressKey(el, { key: 'A', ctrlKey: true });

		const third = await pressKey(el, { key: 'A', ctrlKey: true });

		expect(third.defaultPrevented).toBe(true);
		const selection = mounted.instance.getSelection();
		expect([selection?.anchor.path, selection?.focus.path]).toEqual([[0], [1]]);
	});
});
