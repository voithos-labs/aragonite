import { parse } from '$lib/core/parser';
import { recordingWrite, type RecordedWrite } from '$lib/test/harness/editor-actions';
import {
	createWidgetInteraction,
	type WidgetInteractionDeps
} from '$lib/components/blocks/text/widget-interaction';
import { selectWidgetWhole } from '$lib/selection/caret-doors';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import type { CstNode } from '$lib/core/nodes';
import { fixtureReading, topLevelStore } from '../../harness/fixture-grammar';
import { defaultGrammarView } from '$lib/schema/block-openers';
import type { Reading } from '$lib/schema/reading';
import type { BlockEditActions } from '$lib/action-contracts';
import { createSurfaceWrite } from '$lib/components/blocks/surface-write';

/** A recorded write less its mode. */
export type Commit = Omit<RecordedWrite, 'mode'>;

/** Wire `createWidgetInteraction` over a real parse with the widget at `sourceStart` already
 *  selected. Dependencies this path must not reach are proxy traps, so widening it fails loudly. */
export function harness(
	source: string,
	sourceStart: number,
	reading: Reading = fixtureReading(),
	extra: Partial<WidgetInteractionDeps> = {}
) {
	const node: CstNode = parse(source).children[0];
	const commits: Commit[] = [];
	const carets: (number | null)[] = [];
	const selection = createSelectionState();
	selectWidgetWhole(selection, { paragraphPath: [0], sourceStart, preSelectOffset: sourceStart });

	const trap = () => {
		throw new Error('unexpected dep access on the selected-widget resize path');
	};
	const blockEdit = {
		updateBlockContent: recordingWrite(({ index, raw, before, after }) =>
			commits.push({ index, raw, before, after })
		),
		completeLineOnType: async () => false
	} as unknown as BlockEditActions;
	const deps = {
		get node() {
			return node;
		},
		get index() {
			return 0;
		},
		get myPath() {
			return [0];
		},
		getEl: () => null,
		getEditorContentWidth: () => 800,
		cursor: new Proxy({}, { get: trap }),
		selection,
		blockEdit,
		// A selected widget's key names its own undo caret, so the recorded one is never read.
		writeText: createSurfaceWrite({
			getNode: () => node,
			getIndex: () => 0,
			getPath: () => [0],
			blockEdit,
			kindCue: { afterTypedWrite: async () => {}, labelAt: () => undefined, dismiss: () => {} },
			getPreEditOffset: trap,
			requestCaret: (at) => void carets.push(at)
		}),
		focusActions: new Proxy({}, { get: trap }),
		setSnapTarget: trap,
		setPendingCursor: (offset: number | null) => void carets.push(offset),
		grammar: defaultGrammarView,
		get reading() {
			return reading;
		},
		storedAs: () => topLevelStore(node, reading),
		...extra
	} as unknown as WidgetInteractionDeps;

	return { interaction: createWidgetInteraction(deps), commits, carets, selection };
}
