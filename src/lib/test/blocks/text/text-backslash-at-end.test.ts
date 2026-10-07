// @vitest-environment jsdom
// A backslash the user typed at a block's end is a backslash: the next key types after it, and live
// mode draws it as text rather than as a line waiting for its next key.
// Miss-analysis: GH #522, the pending break was read from a trailing backslash, and no test typed
// one by hand.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	pressKeyAt,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

describe.each(['source', 'live'] as const)('%s mode: a typed backslash at the end', (mode) => {
	it('leaves the next key to type after it', async () => {
		const editor = mountEditor({ source: 'see C:\\\n', presentationMode: mode });

		const e = await pressKeyAt(editor, [0], 7, { key: 'U' });

		expect(e.defaultPrevented).toBe(false);
		expect(editor.source()).toBe('see C:\\\n');
	});
});

describe('live mode: a paragraph ending in a backslash', () => {
	it('draws the backslash as text and opens no line', () => {
		const editor = mountEditor({ source: 'a\\\n', presentationMode: 'live' });
		const el = surfaceAt(editor, [0]);

		expect(el.textContent).toBe('a\\');
		expect(el.querySelector('.md-marker')).toBeNull();
		expect(el.querySelectorAll('br[data-caret-anchor="break"]')).toHaveLength(0);
	});
});
