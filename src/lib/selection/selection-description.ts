/**
 * AT announcement text for a cross-block selection. The overlay paints rects but suppresses
 * native selection, so assistive tech sees nothing without this. Counts top-level blocks
 * spanned; a selection nested inside one top-level block gets a generic phrase.
 */

import type { EditorSelection } from './primitives';
import { normalize } from './primitives';

export function createSelectionDescription(selection: EditorSelection): string {
	const { start, end } = normalize(selection);
	if (start.path.join(',') === end.path.join(',')) return ''; // single-block — native
	// Endpoints inside one top-level block (two items of the same list) span no top-level
	// blocks, and a count would read "1" and mislead.
	if (start.path[0] === end.path[0]) return 'Selected text across blocks';
	return `Selected ${end.path[0] - start.path[0] + 1} blocks`;
}
