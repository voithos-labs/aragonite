import { parse } from '$lib/core/parser';
import {
	createWidgetInteraction,
	type WidgetInteractionDeps
} from '$lib/components/blocks/text/widget-interaction';
import { createWidgetSelectionState } from '$lib/components/image/widget-selection-state.svelte';
import type { CstNode } from '$lib/core/nodes';
import type { LinkReferenceResolverRef } from '$lib/editor-keys';

export interface Commit {
	index: number;
	raw: string;
	before: number;
	after: number;
}

/** Wire `createWidgetInteraction` over a real parse with the widget at `sourceStart`
 *  already selected. Deps the selected-key path must not reach are proxy traps, so a
 *  handler that starts consulting one fails loudly instead of silently widening. */
export function harness(source: string, sourceStart: number, linkRef?: LinkReferenceResolverRef) {
	const node: CstNode = parse(source).children[0];
	const commits: Commit[] = [];
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
		getAmbientLength: () => 0,
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
		setPendingCursor: trap,
		get linkRef() {
			return linkRef;
		}
	} as unknown as WidgetInteractionDeps;

	return { interaction: createWidgetInteraction(deps), commits, widgetSelection };
}
