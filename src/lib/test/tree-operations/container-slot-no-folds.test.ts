// @vitest-environment jsdom
// The chain rebuild's callers that report no fold place no block a container's new bytes read as.
// A replace reaches that reading and re-reads its top-level block whole afterwards; a format chord
// never reaches it, since it writes no opener line and a mark moves no line. Either way the tree is
// the one a reload reads.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { installPlugins } from '#lib';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { admonitionsPlugin } from '#packages/admonitions/src/index.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { createSearchReplace } from '#lib/editor-actions/search-replace.js';
import { makeEditorActionsDeps } from '#lib/test/harness/editor-actions.js';
import { describeConvergence } from '#lib/test/harness/parse-converged.js';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { mountCase, placeRange } from '#lib/test/range-laws/gestures.js';
import type { PresentationMode } from '#lib/presentation-mode.js';

beforeAll(installLayoutStubs);
afterEach(async () => {
	await destroyMountedEditors();
	takeDevWarns();
});

describe('a replace that dissolves a container', () => {
	beforeEach(() => installPlugins([admonitionsPlugin()]));

	it.each([
		{
			where: 'a nested opener line under a blank line',
			source: '::::note\nx\n\n:::tip\nner\n:::\n::::\n',
			path: [0, 2, 0],
			end: 1,
			text: 'x:',
			bytes: '::::note\nx\n\nx:::tip\nner\n:::\n::::\n'
		},
		{
			where: 'a nested opener line flush under a paragraph',
			source: '::::note\nx\n:::tip\nner\n:::\n::::\n',
			path: [0, 2, 0],
			end: 1,
			text: 'x:',
			bytes: '::::note\nx\nx:::tip\nner\n:::\n::::\n'
		},
		{
			where: 'an item with a lazy line, in a quote',
			source: '> - item\n> text\n> 3. three\n',
			path: [0, 0, 0, 0],
			end: 1,
			text: '>i',
			bytes: '> - >item\n> text\n> 3. three\n'
		},
		{
			where: 'an item emptied over its lazy line, in a quote under a paragraph',
			source: '> x\n> - item\n> text\n',
			path: [0, 1, 0, 0],
			end: 4,
			text: '',
			bytes: '> x\n>\n> - \n> text\n'
		}
	])('re-reads the block whole at $where', async ({ source, path, end, text, bytes }) => {
		const { deps } = makeEditorActionsDeps(parse(source));
		const replace = createSearchReplace(deps, createUndoController(deps));

		await replace.replaceAll([{ path, start: 0, end }], text);

		expect(serialize(deps.doc)).toBe(bytes);
		expect(describeConvergence(deps.doc)).toBeNull();
		expect(takeDevWarns().map((warn) => warn.tag)).toEqual([]);
	});
});

describe('a format chord over a range that starts inside an opener line', () => {
	const MODES: PresentationMode[] = ['source', 'live'];

	it.each(MODES)('writes the body and leaves the line as it stood, in %s mode', async (mode) => {
		const editor = mountCase('x\n:::tip Title\nner\n:::\n\n# h\n', mode);
		await editor.settle();
		takeDevWarns();
		await placeRange(editor, {
			anchor: { path: [1, 0], offset: 1 },
			focus: { path: [1, 1], offset: 2 }
		});

		await pressHardwareKey(document.activeElement as HTMLElement, { key: 'b', ctrlKey: true });
		await editor.settle();

		const { __test } = editor.instance;
		expect(editor.source()).toBe('x\n:::tip Title\n**ne**r\n:::\n\n# h\n');
		expect(describeConvergence(__test.getDocument(), __test.getGrammar())).toBeNull();
		expect(takeDevWarns().map((warn) => warn.tag)).toEqual([]);
	});
});
