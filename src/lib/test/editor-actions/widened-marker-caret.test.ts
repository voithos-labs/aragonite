// @vitest-environment jsdom
// A space typed at the start of a list item's text, which the item's widened marker takes, leaves
// the caret right after the marker, also when the item's sublist spills out of the list.
// Miss-analysis: the widened-marker rows ran headless and read no caret; the behavior differential
// found this one in a seeded sequence, and a differential compares but pins nothing.

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

it('a space the marker takes, as the sublist spills, leaves the caret after the marker', async () => {
	const editor = mountEditor<EditorTestSurface>({
		source: '- a\n- b\n- \\\n  c\n\n  - x\n',
		presentationMode: 'live',
		plugins: SYNTAX_PLUGINS
	});
	await editor.settle();
	const el = surfaceAt(editor, [0, 2, 0]);
	placeCaret(el, 0);

	await pressHardwareKey(el, { key: ' ' });
	await editor.settle();

	expect(editor.source()).toBe('- a\n- b\n-  \\\n  c\n\n  - x\n');
	const caret = { path: [0, 2, 0], offset: 0 };
	expect(editor.instance.getSelection()).toEqual({ anchor: caret, focus: caret });
});
