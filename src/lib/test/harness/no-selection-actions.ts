// The root menus' selection actions for a suite that lists no plugin value.
import type { SelectionActions } from '#lib/components/editor-root/selection-actions.js';

export const noSelectionActions: SelectionActions = {
	atSelection: () => [],
	wholeSelection: () => [],
	over: () => null,
	rows: () => ({ entries: () => [], pick: () => false, closed: () => {} })
};
