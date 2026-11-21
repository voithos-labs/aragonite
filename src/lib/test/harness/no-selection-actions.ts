// The root menus' plugin rows for a suite that lists no plugin value.
import type { SelectionActions } from '#lib/components/editor-root/selection-actions.js';
import type { RootMenusDeps } from '#lib/components/editor-root/menus.js';

export const noSelectionActions: SelectionActions = {
	atSelection: () => [],
	wholeSelection: () => [],
	over: () => null,
	rows: () => ({ entries: () => [], pick: () => false, closed: () => {} })
};

/** The root menus' block type rows for a suite that lists no plugin value. */
export const noBlockTypes: RootMenusDeps['blockTypes'] = {
	blockActions: () => [],
	blockOf: () => {
		throw new Error('no block type rows to read a block for');
	},
	run: () => false,
	can: () => false
};
