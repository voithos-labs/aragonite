// @vitest-environment jsdom
// Home below a marker's first line is the browser's own: it goes to the start of that line.
// Miss-analysis: every Home test started on a one-line item, where the item's start and the
// caret's line start are the same offset, so a clamp that ignored the line passed them all.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	pressKeyAt
} from '$lib/test/harness/mount-editor.svelte';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

// Each block's text is `abc def\` + newline + `e.g.`, so offset 11 sits inside `e.g.`.
const IN_SECOND_LINE = 11;

describe.each([
	['a list item', '- abc def\\\n  e.g.\n', [0, 0, 0]],
	['a task item', '- [ ] abc def\\\n  e.g.\n', [0, 0, 0]],
	['an ordered item in a quote', '> 1. abc def\\\n>    e.g.\n', [0, 0, 0, 0]]
])('Home on the second line of %s', (_name, source, path) => {
	it.each(['source', 'live'] as const)(
		'%s: leaves the key to the browser, not the item start',
		async (presentationMode) => {
			const mounted = mountEditor({ source, presentationMode });

			const event = await pressKeyAt(mounted, path, IN_SECOND_LINE, { key: 'Home' });

			expect(event.defaultPrevented).toBe(false);
			expect(mounted.instance.getSelection()?.focus).toEqual({ path, offset: IN_SECOND_LINE });
			expect(mounted.source()).toBe(source);
		}
	);
});
