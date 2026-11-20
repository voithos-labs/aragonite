// @vitest-environment jsdom
// The line a pasted last line ending opens at a container's end holds the caret as a gap among that
// container's children, whatever the block above it holds: text inside a block pasted there (a
// footnote's) is not on that line, so the next letter does not join it.
// Miss-analysis: the held-gap rows pasted blocks with no text place at a container's end (a table,
// a fence), so none stood the line under a block holding prose, where the caret fell into it.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PresentationMode } from '#lib/presentation-mode.js';
import { registerDefaultContextActions } from '#lib/components/menu/default-context-actions.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { pointAtByte } from '#lib/selection/range-bytes.js';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { mountCase, pasteGesture, placeRange } from '../range-laws/gestures';

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
	registerDefaultContextActions();
});
afterEach(async () => {
	await destroyMountedEditors();
	takeDevWarns();
});

const HOSTS: [name: string, marked: string][] = [
	['a quote', '> alpha‸\n\nAfter\n'],
	['an alert', '> [!NOTE]\n> alpha‸\n\nAfter\n']
];
const CLIPS: [name: string, clip: string, last: string][] = [
	['a footnote', '[^9]: note\n', '> [^9]: note\n'],
	['a table', '| a |\n| - |\n', '> | - |\n'],
	['a fence', '```\ncode\n```\n', '> ```\n']
];
const MODES: PresentationMode[] = ['source', 'live'];

describe('the line a pasted ending opens at a container’s end', () => {
	for (const mode of MODES)
		for (const [host, marked] of HOSTS)
			for (const [what, clip, last] of CLIPS)
				it(`${mode}: ${what} at the end of ${host} leaves the caret on that line`, async () => {
					const editor = mountCase(marked.replace('‸', ''), mode);
					await editor.settle();
					const doc = measured(editor.instance.__test.getDocument());
					const at = pointAtByte(doc, marked.indexOf('‸'))!;
					expect(await placeRange(editor, { anchor: at, focus: at })).toBe(true);
					await pasteGesture(editor, { 'text/plain': clip }, 'key');
					expect(editor.instance.__test.getGapCaret()).toMatchObject({ parentPath: [0], index: 2 });
					await pressHardwareKey(document.activeElement as HTMLElement, { key: 'Z' });
					await editor.settle();
					expect(editor.source()).toContain(`${last}>\n> Z\n`);
					expect(takeDevWarns().map((warn) => warn.tag)).toEqual([]);
				});
});
