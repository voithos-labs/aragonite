// The root menus' selection actions for a suite that lists no plugin value.
import type { SelectionActions } from '#lib/components/editor-root/selection-actions.js';

export const noSelectionActions: SelectionActions = {
	atSelection: () => [],
	selectionBytes: () => null,
	over: () => null,
	rows: () => [],
	pick: () => null
};
