/**
 * AT announcement text for a cross-block selection. The overlay paints rects but suppresses
 * native selection, so assistive tech sees nothing without this. Counts top-level blocks
 * spanned; a selection nested inside one top-level block gets a generic phrase.
 */

import type { EditorSelection } from './primitives';
import { normalize } from './primitives';
import { pathsEqual } from './path-math';
import { SELECTED_ACROSS_BLOCKS, selectedBlocks } from '../a11y-strings';

export function createSelectionDescription(selection: EditorSelection): string {
	const { start, end } = normalize(selection);
	if (pathsEqual(start.path, end.path)) return ''; // single-block — native
	// Endpoints inside one top-level block (two items of the same list) span no top-level
	// blocks, and a count would read "1" and mislead.
	if (start.path[0] === end.path[0]) return SELECTED_ACROSS_BLOCKS;
	return selectedBlocks(end.path[0] - start.path[0] + 1);
}
