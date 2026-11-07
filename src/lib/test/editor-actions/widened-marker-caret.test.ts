// @vitest-environment jsdom
// A space typed at the start of a list item's text, which the item's widened marker takes, puts
// the next letter before the text, also when the item's next paragraph leaves the list.
// Miss-analysis: the re-read rows checked which nodes and ids survived, never typed after one; a
// typed leaf whose id survived its list's re-read kept showing the space its marker took.

import { afterEach, beforeAll, expect, it } from 'vitest';
import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { SYNTAX_PLUGINS } from '../behavior/corpus';

beforeAll(installLayoutStubs);
afterEach(async () => {
	await destroyMountedEditors();
	expect(takeDevWarns()).toEqual([]);
});

it.each(['source', 'live'] as const)(
	'the next letter goes before the text after the marker took a space, %s',
	async (mode) => {
		const editor = mountEditor<EditorTestSurface>({
			source: '- ab\n\n  b\n',
			presentationMode: mode,
			plugins: SYNTAX_PLUGINS
		});
		await editor.settle();
		const el = surfaceAt(editor, [0, 0, 0]);
		placeCaret(el, 0);

		await pressHardwareKey(el, { key: ' ' });
		await editor.settle();
		await pressHardwareKey(document.activeElement as HTMLElement, { key: 'X' });
		await editor.settle();

		expect(editor.source()).toBe('-  Xab\n\n  b\n');
	}
);
