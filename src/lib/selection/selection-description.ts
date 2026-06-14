/**
 * AT announcement text for a cross-block selection. The visual overlay paints
 * rects but suppresses native selection, so assistive tech sees nothing without
 * this. Pure — fed to the editor-root live region. Top-level span only; finer
 * granularity isn't needed for an announcement.
 */

import type { EditorSelection } from './primitives';
import { normalize } from './primitives';

export function createSelectionDescription(selection: EditorSelection): string {
	const { start, end } = normalize(selection);
	if (start.path.join(',') === end.path.join(',')) return ''; // single-block — native
	const count = Math.abs(end.path[0] - start.path[0]) + 1;
	return `Selected ${count} blocks`;
}
