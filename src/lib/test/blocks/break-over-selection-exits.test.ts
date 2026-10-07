// @vitest-environment jsdom
// Enter over a selection splits where the selection was and never takes a block's "Enter on an
// empty line" exit, which answers to the block as it was when the key was pressed.
// Miss-analysis: every break-over-selection row selected a middle span, so nothing emptied the
// block before the command ran.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	selectRange,
	surfaceAt
} from '$lib/test/harness/mount-editor.svelte';
import { pressKey, settleEditor } from '$lib/test/harness/settle';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

const MODES = ['source', 'live'] as const;

// Each row selects `[start, end)` of the leaf at `path`, then presses Enter.
const IN_BLOCK = [
	['a list item, whole', '- alpha\n\nnext\n', [0, 0, 0], 0, 5, '- \n- \n\nnext\n'],
	['a to-do, whole', '- [ ] alpha\n\nnext\n', [0, 0, 0], 0, 5, '- [ ] \n- [ ] \n\nnext\n'],
	['a quote’s only line, whole', '> alpha\n\nnext\n', [0, 0], 0, 5, '>\n>\n\nnext\n'],
	['a second item, whole', '- one\n- alpha\n\nnext\n', [0, 1, 0], 0, 5, '- one\n- \n- \n\nnext\n'],
	[
		'a code block’s last line',
		'```\nfoo\nbar\n```\n\nnext\n',
		[0],
		8,
		11,
		'```\nfoo\n\n\n```\n\nnext\n'
	]
] as const;

describe.each(MODES)('%s mode: Enter over a selection that empties a line', (mode) => {
	it.each(IN_BLOCK)('%s splits and stays in the block', async (...row) => {
		const [, source, path, start, end, written] = row;
		const editor = mountEditor({ source, presentationMode: mode });
		await settleEditor();
		selectRange(surfaceAt(editor, [...path]), start, end);

		await pressKey(surfaceAt(editor, [...path]), { key: 'Enter' });
		await settleEditor();

		expect(editor.source()).toBe(written);
	});

	// An emptied heading the caret leaves turns into the paragraph it looks like, however it
	// was emptied, so a whole-heading break ends where Enter in an empty heading does.
	it('a heading, whole: the same bytes as Enter in an empty heading', async () => {
		const selected = mountEditor({ source: '# alpha\n\nnext\n', presentationMode: mode });
		selectRange(surfaceAt(selected, [0]), 2, 7);
		await pressKey(surfaceAt(selected, [0]), { key: 'Enter' });
		await settleEditor();
		const atCaret = mountEditor({ source: '# \n\nnext\n', presentationMode: mode });
		placeCaret(surfaceAt(atCaret, [0]), 2);
		await pressKey(surfaceAt(atCaret, [0]), { key: 'Enter' });
		await settleEditor();

		expect(selected.source()).toBe(atCaret.source());
	});
});

// The exits themselves still answer Enter at a caret in an empty line.
describe('Enter at a caret on an empty line still leaves the block', () => {
	it.each([
		['an empty item leaves the list', '- \n\nnext\n', [0, 0, 0], 0, '\nnext\n'],
		[
			'a code block’s empty last line',
			'```\nfoo\n\n```\n\nnext\n',
			[0],
			8,
			'```\nfoo\n```\n\nnext\n'
		]
	] as const)('%s', async (_, source, path, at, written) => {
		const editor = mountEditor({ source });
		await settleEditor();
		placeCaret(surfaceAt(editor, [...path]), at);

		await pressKey(surfaceAt(editor, [...path]), { key: 'Enter' });
		await settleEditor();

		expect(editor.source()).toBe(written);
	});
});

// The range's own route: a key over a range spanning blocks removes it, then runs the command.
describe('Enter over a range spanning blocks that empties a line', () => {
	it.each([
		['two items', '- alpha\n- beta\n\nnext\n', [0, 0, 0], [0, 1, 0], '- \n- \n\nnext\n'],
		['a quote’s lines', '> alpha\n>\n> beta\n\nnext\n', [0, 0], [0, 1], '>\n>\n\nnext\n']
	] as const)('%s splits and stays in the block', async (_, source, from, to, written) => {
		const editor = mountEditor({ source });
		await settleEditor();
		await editor.instance.setSelection({
			anchor: { path: [...from], offset: 0 },
			focus: { path: [...to], offset: 4 }
		});
		await settleEditor();

		await pressKey(surfaceAt(editor, [...to]), { key: 'Enter' });
		await settleEditor();

		expect(editor.source()).toBe(written);
	});
});
