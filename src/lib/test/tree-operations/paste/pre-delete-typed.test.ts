// @vitest-environment jsdom
// In live mode a paste over a selection writes what typing the same text over it writes.
// Miss-analysis: the paste rows cut a range that left the run unpaired, never one the pasted text
// refills, so no row saw the cut cleaned without the text it was about to take.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import TextEditableBlock from '#lib/components/blocks/text/TextEditableBlock.svelte';
import { parse } from '#lib/core/parser.js';
import { trimTrailingLineEnding, ownTrailingLineEnding } from '#lib/core/lines.js';
import type { CstNode } from '#lib/core/nodes.js';
import { asDomTextOffset } from '#lib/cursor/coordinate-spaces.js';
import { createRangeAtDomTextOffsets } from '#lib/cursor/widget-offset.js';
import { nodeAt } from '#lib/tree-operations/node-primitives.js';
import { pasteDispatch } from '#lib/tree-operations/paste/dispatch.js';
import { cleanLiveJoinSeam } from '#lib/components/blocks/text/live-join-seam.js';
import { tableCellPasteSurface } from '#lib/components/blocks/table/table-cell-paste.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { createPasteCoordinator } from '#lib/editor-actions/paste-coordinator.js';
import {
	registerLiveJoinSeamCleaner,
	__resetLiveJoinSeamCleanerForTests
} from '#lib/schema/inline-construct-policy.js';
import {
	makeEditorActionsDeps,
	makeStubBlockEdit,
	pasteContext
} from '../../harness/editor-actions';
import { fixtureReading } from '../../harness/fixture-grammar';
import { mountBlock } from '../../harness/mount-block';
import { settleEditor } from '../../harness/settle';
import { ensurePasteSurface } from '../../support/paste-surface';
import { mountCell, noIslands } from '../../blocks/table/mount-cell';

const LIVE = fixtureReading({}, 'live');

beforeAll(() => {
	registerLiveJoinSeamCleaner(cleanLiveJoinSeam);
	ensurePasteSurface(tableCellPasteSurface);
});
afterEach(() => {
	document.body.innerHTML = '';
	window.getSelection()?.removeAllRanges();
});
afterAll(() => __resetLiveJoinSeamCleanerForTests());

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
	const { deps } = makeEditorActionsDeps(place.wrap(text), { reading: LIVE });
	const blockEdit = makeStubBlockEdit();
	await pasteDispatch(
		{ pastedText: 'x', targetPath: place.leaf, offset: range.start, preDelete: range },
		pasteContext({
			doc: deps.doc,
			blockEdit,
			reading: LIVE,
			controller: createPasteCoordinator(deps, createUndoController(deps))
		})
	);
	return leafBytes(vi.mocked(blockEdit.updateBlockContent).mock.calls);
}

/** `x` typed over `range`: the block's own rewrite, else the edit the browser keeps. */
async function type(place: Place, text: string, range: { start: number; end: number }) {
	const mounted = place.inCell
		? mountCell(text, { presentationMode: () => 'live' })
		: mountText(place, text);
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
			policies: { presentationMode: () => 'live' },
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

// The pasted text lands where the cleanup left the join, so the caret moves with the runs it dropped.
it('a paste over a range whose cleanup drops a run puts the caret after the pasted text', async () => {
	const { deps } = makeEditorActionsDeps('**ab** c\n', { reading: LIVE });
	const blockEdit = makeStubBlockEdit();
	await pasteDispatch(
		{ pastedText: 'x', targetPath: [0], offset: 3, preDelete: { start: 3, end: 8 } },
		pasteContext({
			doc: deps.doc,
			blockEdit,
			reading: LIVE,
			controller: createPasteCoordinator(deps, createUndoController(deps))
		})
	);
	const [call] = vi.mocked(blockEdit.updateBlockContent).mock.calls;
	expect([call[1], call[4]]).toEqual(['ax\n', 2]);
});
