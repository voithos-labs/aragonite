// In selection/ because overlay rendering and clipboard-out pick the mode before any table component is involved.

import type { EditorSelection } from './primitives';
import { pathsEqual } from './path-math';

export type TableSelectionMode = 'rectangular' | 'linear';

export function selectionInTableMode(selection: EditorSelection): TableSelectionMode {
	return pathsEqual(selection.anchor.path, selection.focus.path) ? 'rectangular' : 'linear';
}
