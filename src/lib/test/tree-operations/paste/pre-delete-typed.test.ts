// @vitest-environment jsdom
// In live mode a paste over a selection writes what typing the same text over it writes.
// Miss-analysis: the paste rows cut a range that left the run unpaired, never one the pasted text
// refills, so no row saw the cut cleaned without the text it was about to take.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import TextEditableBlock from '#lib/components/blocks/text/TextEditableBlock.svelte';
import { parse } from '#lib/core/parser.js';
import { trimTrailingLineEnding, ownTrailingLineEnding } from '#lib/core/lines.js';
import type { CstNode } from '#lib/core/nodes.js';
import { asDomTextOffset } from '#lib/core/coordinate-spaces.js';
import { createRangeAtDomTextOffsets } from '#lib/browser/offsets.js';
import { nodeAt } from '#lib/tree-operations/node-primitives.js';
import { tableCellPasteSurface } from '#lib/components/blocks/table/table-cell-paste.js';
import { makeStubBlockEdit, runPasteDispatch, makePasteCommit } from '../../harness/editor-actions';
import { fixtureReading } from '../../harness/fixture-grammar';
import { mountBlock } from '../../harness/mount-block';
import { settleEditor } from '../../harness/settle';
import { ensurePasteSurface } from '../../harness/paste-surface';
import { mountCell, noIslands } from '../../blocks/table/mount-cell';

const LIVE = fixtureReading({}, 'live');

beforeAll(() => {
	ensurePasteSurface(tableCellPasteSurface);
});
afterEach(() => {
	document.body.innerHTML = '';
	window.getSelection()?.removeAllRanges();
});

interface Place {
	name: string;
	/** The document around `text`, which `text` replaces. */
	wrap(text: string): string;
	leaf: number[];
	inCell: boolean;
}

const PLACES: Place[] = [
	{ name: 'the top level', wrap: (text) => `${text}\n`, leaf: [0], inCell: false },
	{ name: 'a list item', wrap: (text) => `- ${text}\n`, leaf: [0, 0, 0], inCell: false },
	{
		name: 'a table cell',
		wrap: (text) => `| h |\n| - |\n| ${text} |\n`,
		leaf: [0, 1, 0],
		inCell: true
	}
];

/** The leaf's bytes after the gesture: the one commit, or none when nothing was written. */
const leafBytes = (calls: unknown[][]): string[] => calls.map((call) => call[1] as string);

async function paste(place: Place, text: string, range: { start: number; end: number }) {
	const h = makePasteCommit(place.wrap(text), { reading: LIVE });
	const blockEdit = makeStubBlockEdit();
	await runPasteDispatch(
		h,
		{ pastedText: 'x', targetPath: place.leaf, offset: range.start, preDelete: range },
		{ blockEdit }
	);
	return leafBytes(vi.mocked(blockEdit.updateBlockContent).mock.calls);
}

/** `x` typed over `range`: the block's own rewrite, else the edit the browser keeps. */
async function type(place: Place, text: string, range: { start: number; end: number }) {
	const mounted = place.inCell ? mountCell(text, { mode: () => 'live' }) : mountText(place, text);
	const { el } = mounted;
	el.focus();
	const at = createRangeAtDomTextOffsets(
		el,
		asDomTextOffset(range.start),
		asDomTextOffset(range.end)
	)!;
	window.getSelection()!.removeAllRanges();
	window.getSelection()!.addRange(at);
	const e = new InputEvent('beforeinput', {
		inputType: 'insertText',
		data: 'x',
		bubbles: true,
		cancelable: true
	});
	Object.defineProperty(e, 'getTargetRanges', { value: () => [at] });
	el.dispatchEvent(e);
	await settleEditor();
	const written = leafBytes(vi.mocked(mounted.blockEdit.updateBlockContent).mock.calls);
	if (e.defaultPrevented) return written;
	const raw = (nodeAt(parse(place.wrap(text)), place.leaf) as CstNode).raw;
	const display = trimTrailingLineEnding(raw);
	return [
		display.slice(0, range.start) + 'x' + display.slice(range.end) + ownTrailingLineEnding(raw)
	];
}

function mountText(place: Place, text: string) {
	const mounted = mountBlock(TextEditableBlock, {
		source: place.wrap(text),
		path: place.leaf,
		overrides: {
			mode: () => 'live',
			services: { decorations: noIslands }
		}
	});
	const el = mounted.target.querySelector('.text-editable-block') as HTMLElement;
	return { el, blockEdit: mounted.blockEdit };
}

const ending = (place: Place): string => (place.inCell ? '' : '\n');

describe.each(PLACES)('a paste over a whole bold word, in $name', (place) => {
	it('keeps the bold, as typing does', async () => {
		expect(await paste(place, '**a** b', { start: 2, end: 3 })).toEqual([
			`**x** b${ending(place)}`
		]);
	});
});

// Each selection once refilled by the text and once crossing a hidden run, where the join has to clean.
const SELECTIONS = [
	{ shape: 'the bold word', text: '**a** b', range: { start: 2, end: 3 } },
	{ shape: 'from inside the bold past its closer', text: '**ab** c', range: { start: 3, end: 8 } },
	{ shape: 'from before the bold into it', text: 'a **bc**', range: { start: 0, end: 5 } }
];

describe.each(PLACES)('typing and pasting over one selection, in $name', (place) => {
	it.each(SELECTIONS)('$shape: write the same bytes', async ({ text, range }) => {
		const typed = await type(place, text, range);
		document.body.innerHTML = '';
		expect(await paste(place, text, range)).toEqual(typed);
	});
});

// The pasted text lands inside the run the cleanup closed, and the caret right after it.
it('a paste over a range whose cleanup closes a run puts the caret after the pasted text', async () => {
	const h = makePasteCommit('**ab** c\n', { reading: LIVE });
	const blockEdit = makeStubBlockEdit();
	await runPasteDispatch(
		h,
		{ pastedText: 'x', targetPath: [0], offset: 3, preDelete: { start: 3, end: 8 } },
		{ blockEdit }
	);
	const [call] = vi.mocked(blockEdit.updateBlockContent).mock.calls;
	expect([call[1], call[5]]).toEqual(['**ax**\n', 4]);
});
