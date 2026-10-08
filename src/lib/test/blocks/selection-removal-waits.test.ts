// @vitest-environment jsdom
// A line break over a selection runs only once the selection's removal has landed, and not at all
// when the removal's bytes don't land: Enter in a code block and a paragraph, `<br>` in a table cell.
// Miss-analysis: every break-over-selection test committed at once, so a block that answered its
// removal before the write settled ran the break early with every suite green.
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Component } from 'svelte';
import CodeBlock from '#lib/components/blocks/code/CodeBlock.svelte';
import TextEditableBlock from '#lib/components/blocks/text/TextEditableBlock.svelte';
import TableCellBlock from '#lib/components/blocks/table/TableCellBlock.svelte';
import { TABLE_CONTEXT_KEY } from '#lib/editor-keys.js';
import type { SelectionRemoval } from '#lib/components/blocks/editable-surface.js';
import { withStoredCaret } from '#lib/editor-actions/stored-caret.js';
import { asDomTextOffset } from '#lib/cursor/coordinate-spaces.js';
import { createRangeAtDomTextOffsets } from '#lib/cursor/widget-offset.js';
import {
	mountBlock,
	type MountBlockOptions,
	type MountedBlock
} from '#lib/test/harness/mount-block.js';
import { makeStubBlockEdit } from '#lib/test/harness/editor-actions.js';
import { settleEditor } from '#lib/test/harness/settle.js';

let mounted: MountedBlock<Record<string, unknown>> | undefined;

afterEach(async () => {
	await mounted?.dispose();
	mounted = undefined;
	document.body.innerHTML = '';
});

const enter = () => new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });

// A cell's `<br>` comes in as input; the cell is mounted alone, its table answering nothing.
const lineBreak = () =>
	new InputEvent('beforeinput', { inputType: 'insertLineBreak', bubbles: true, cancelable: true });
const silentTable = new Proxy({}, { get: () => () => {} });

interface Surface {
	kind: string;
	component: Component<any, any>;
	options: MountBlockOptions;
	/** Where the selected word `bar` starts in the editable element's text. */
	at: number;
	press(): Event;
}

const SURFACES: Surface[] = [
	{
		kind: 'a code block',
		component: CodeBlock,
		options: { source: '```\nfoo bar\n```\n' },
		at: 8,
		press: enter
	},
	{
		kind: 'a paragraph',
		component: TextEditableBlock,
		options: { source: 'foo bar\n' },
		at: 4,
		press: enter
	},
	{
		kind: 'a table cell',
		component: TableCellBlock,
		options: {
			source: '| a | b |\n| --- | --- |\n| foo bar | x |\n',
			path: [0, 1, 0],
			props: { rowIdx: 1, columnCount: 2, rowCount: 2 },
			context: [[TABLE_CONTEXT_KEY, silentTable]]
		},
		at: 4,
		press: lineBreak
	}
];

/** The block mounted over a stub list whose content writes settle only when the test says. */
function mountHeld({ component, options }: Surface) {
	const blockEdit = makeStubBlockEdit();
	let settle: (landed: boolean) => void = () => {};
	vi.mocked(blockEdit.updateBlockContent).mockImplementation((_index, _text, _mode, pre, saved) =>
		withStoredCaret(new Promise<boolean>((done) => (settle = done)), saved ?? pre)
	);
	mounted = mountBlock(component, { ...options, overrides: { blockEdit } });
	const calls = () =>
		Object.values(blockEdit)
			.filter((spy) => vi.isMockFunction(spy))
			.reduce((sum, spy) => sum + vi.mocked(spy).mock.calls.length, 0);
	return { calls, settle: (landed: boolean) => settle(landed) };
}

function breakOver({ at, press }: Surface): void {
	const el = mounted!.target.querySelector('[contenteditable="true"]') as HTMLElement;
	const range = createRangeAtDomTextOffsets(el, asDomTextOffset(at), asDomTextOffset(at + 3));
	el.focus();
	window.getSelection()?.removeAllRanges();
	window.getSelection()?.addRange(range!);
	el.dispatchEvent(press());
}

describe.each(SURFACES)('a line break over a selection in $kind', (surface) => {
	it('breaks the line only after the removal lands', async () => {
		const held = mountHeld(surface);
		breakOver(surface);
		await settleEditor();
		expect(held.calls()).toBe(1);

		held.settle(true);
		await settleEditor();
		expect(held.calls()).toBeGreaterThan(1);
	});

	it('breaks nothing when the removal lands no bytes', async () => {
		const held = mountHeld(surface);
		breakOver(surface);
		await settleEditor();

		held.settle(false);
		await settleEditor();
		expect(held.calls()).toBe(1);
	});
});

// The removal's type carries its timing: an answer that isn't the block's own write doesn't compile.
it('a removal cannot answer before its write', () => {
	const early: SelectionRemoval[] = [
		// @ts-expect-error a bare true claims bytes landed that no write made
		true,
		// @ts-expect-error so does a promise that isn't the block's write
		Promise.resolve(true)
	];
	expect(early).toHaveLength(2);
});
