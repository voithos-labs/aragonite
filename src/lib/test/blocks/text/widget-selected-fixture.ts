import { parse } from '$lib/core/parser';
import {
	createWidgetInteraction,
	type WidgetInteractionDeps
} from '$lib/components/blocks/text/widget-interaction';
import { createWidgetSelectionState } from '$lib/components/image/widget-selection-state.svelte';
import type { CstNode } from '$lib/core/nodes';
import { fixtureReading } from '../../harness/fixture-grammar';
import { defaultGrammarView } from '$lib/schema/block-openers';
import type { Reading } from '$lib/schema/reading';

export interface Commit {
	index: number;
	raw: string;
	before: number;
	after: number;
}

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
	const widgetSelection = createWidgetSelectionState({ onSelect: () => {} });
	widgetSelection.select({ paragraphPath: [0], sourceStart, preSelectOffset: sourceStart });

	const trap = () => {
		throw new Error('unexpected dep access on the selected-widget resize path');
	};
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
		widgetSelection,
		blockEdit: {
			updateBlockContent: (index: number, raw: string, before: number, after: number) => {
				commits.push({ index, raw, before, after });
			}
		},
		focusActions: new Proxy({}, { get: trap }),
		setSnapTarget: trap,
		setPendingCursor: (offset: number | null) => void carets.push(offset),
		grammar: defaultGrammarView,
		get reading() {
			return reading;
		},
		...extra
	} as unknown as WidgetInteractionDeps;

	return { interaction: createWidgetInteraction(deps), commits, carets, widgetSelection };
}
