// @vitest-environment jsdom
// In live mode, taking a widget or a decoration's range out of a block cleans the join like any
// other cut: a bold word emptied of its only widget leaves no `****` behind.
// Miss-analysis: the widget and decoration deletes were tested for their undo anchor and caret, always
// outside a construct, so their literal splice never had a delimiter run beside it.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { parse } from '$lib/core/parser';
import type { CstNode } from '$lib/core/nodes';
import { trimTrailingLineEnding } from '$lib/core/lines';
import { cleanLiveJoinSeam } from '$lib/components/blocks/text/live-join-seam';
import {
	registerLiveJoinSeamCleaner,
	__resetLiveJoinSeamCleanerForTests
} from '$lib/schema/inline-construct-policy';
import {
	createTextClipboard,
	type TextClipboardDeps
} from '$lib/components/blocks/text/text-clipboard';
import { selectWidgetWhole } from '$lib/selection/caret-doors';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { storedAsAt } from '$lib/tree-operations/stored-as';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import { everyInstalledPlugin } from '$lib/schema/plugin-activation';
import { stubCaretMemory } from '$lib/testing/headless-actions';
import { makeEditorActionsDeps, makeStubBlockEdit } from '../../harness/editor-actions';
import { fixtureReading } from '../../harness/fixture-grammar';
import { harness as selectedWidget } from './widget-selected-fixture';
import {
	at,
	installEdgeDispatchCleanup,
	key,
	makeEdgeDispatch,
	mountIslandBlock,
	mountSurface
} from './edge-policy-fixture';

const LIVE = fixtureReading({}, 'live');
const IMAGE = 'x **![a](b.png)** y\n';
const IMAGE_RANGE = { start: 4, end: 15 };

beforeAll(() => registerLiveJoinSeamCleaner(cleanLiveJoinSeam));
afterAll(() => __resetLiveJoinSeamCleanerForTests());
installEdgeDispatchCleanup();

const storeOf = (source: string) => {
	const doc = parse(source);
	return () => storedAsAt(doc, [0], LIVE);
};

describe('the caret-edge keys', () => {
	it('Backspace after an entity alone in a bold word takes the pair too', () => {
		const node = parse('x **&copy;** y\n').children[0];
		const el = mountSurface(trimTrailingLineEnding(node.raw), 'live');
		const h = makeEdgeDispatch(node, el, { storedAs: storeOf('x **&copy;** y\n') });
		h.handleKeydown(key('Backspace'), at(10));
		expect(h.edits.map((edit) => edit[1])).toEqual(['x  y\n']);
	});

	it('deleting a selected decoration over a whole bold word takes the pair too', () => {
		const { node, el } = mountIslandBlock('x **ab** y\n', 4, 6, 'live');
		const h = makeEdgeDispatch(node, el, {
			hasIslands: () => true,
			getRawSelection: () => ({ start: 4, end: 6 }) as never,
			storedAs: storeOf('x **ab** y\n')
		});
		h.handleKeydown(key('Backspace'), at(6));
		expect(h.edits.map((edit) => edit[1])).toEqual(['x  y\n']);
	});
});

describe('a selected widget', () => {
	it('Backspace takes the pair its bold word held it in', async () => {
		const h = selectedWidget(IMAGE, IMAGE_RANGE.start, LIVE, { storedAs: storeOf(IMAGE) });
		await h.interaction.handleSelectedWidgetKeydown(key('Backspace'));
		expect(h.commits.map((commit) => commit.raw)).toEqual(['x  y\n']);
	});

	// The closer and opener the cut brings back to back around nothing make one bold word again.
	it('a cut between two bold words joins them', async () => {
		const { handlers, writes } = clipboardOver('**a**![w](b.png)**c**\n', 5);
		await handlers.onCut(clipboardEvent('') as never);
		expect(writes()).toEqual(['**ac**\n']);
	});

	// The same route a paste over any selection takes, so the pasted line's own ending goes here.
	it('a paste over it ending the line drops the pasted line’s ending', async () => {
		const { handlers, writes } = clipboardOver('x ![a](b.png)\n', 2);
		await handlers.onPaste(clipboardEvent('z\n') as never);
		await tick();
		expect(writes()).toEqual(['x z\n']);
	});
});

function clipboardEvent(text: string) {
	return {
		preventDefault: () => {},
		clipboardData: {
			setData: () => {},
			getData: (type: string) => (type === 'text/plain' ? text : ''),
			files: [],
			items: []
		}
	};
}

/** The clipboard handlers of the block holding `source`, with its widget at `start` selected. */
function clipboardOver(source: string, start = IMAGE_RANGE.start) {
	const { deps: actions } = makeEditorActionsDeps(source, { reading: LIVE });
	const blockEdit = makeStubBlockEdit();
	const selection = createSelectionState();
	selectWidgetWhole(selection, { paragraphPath: [0], sourceStart: start, preSelectOffset: start });
	const deps = {
		get node() {
			return actions.doc.children[0] as CstNode;
		},
		index: 0,
		myPath: [0],
		cursor: { getRaw: () => null, getRawSelection: () => null },
		selection,
		crossBlock: { handlePaste: async () => false, handleCut: async () => false },
		caretMemory: stubCaretMemory(),
		blockEdit,
		pasteCoordinator: createPasteCoordinator(actions, createUndoController(actions)),
		activePlugins: everyInstalledPlugin,
		getDoc: () => actions.doc,
		setPendingCursor: () => {},
		isReadOnly: () => false,
		foldRevealBeforeMutation: () => null,
		isRevealing: () => false,
		storedAs: () => storedAsAt(actions.doc, [0], LIVE),
		reading: LIVE
	} as unknown as TextClipboardDeps;
	const writes = () => vi.mocked(blockEdit.updateBlockContent).mock.calls.map((call) => call[1]);
	return { handlers: createTextClipboard(deps), writes };
}
