/**
 * Puts back a selection saved before a detour (a presentation-mode switch, the find bar) through
 * the caret landing's `restore`, unless a widget is still selected: then the widget stays selected
 * and its block takes focus again, since the saved caret is only the widget's stand-in. Interim,
 * until the landing's `restore` takes a selected widget itself (T21 slice 2).
 */

import type { BlockElLookup } from '../editor-keys';
import type { CaretLanding, LandOptions } from './caret-landing';
import type { EditorSelection } from './primitives';
import type { SelectionRestoreOutcome } from './selection-restore';
import type { SelectionState } from './selection-state.svelte';

export interface RoundTripRestoreDeps {
	selection: Pick<SelectionState, 'widget' | 'announceSelection'>;
	landing: Pick<CaretLanding, 'restore' | 'mount'>;
	getBlockElByPath: BlockElLookup;
}

export type RoundTripRestore = (
	selection: EditorSelection,
	opts?: LandOptions
) => Promise<SelectionRestoreOutcome>;

export function createRoundTripRestore(deps: RoundTripRestoreDeps): RoundTripRestore {
	return async (selection, opts) => {
		const widget = deps.selection.widget;
		if (!widget) return deps.landing.restore(selection, opts);
		await deps.landing.mount(widget.paragraphPath);
		const blockEl = deps.getBlockElByPath(widget.paragraphPath);
		blockEl?.focus({ preventScroll: true });
		// Once, as the caret restore it stands in for announces.
		deps.selection.announceSelection();
		return blockEl ? 'applied' : 'unplaced';
	};
}
