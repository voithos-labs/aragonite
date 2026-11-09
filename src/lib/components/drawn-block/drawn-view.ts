/** A block type's view, drawn by the editor's draw host. The view carries the host, so a page with
 *  no drawn block type never loads it. */
import { asBlockView, type BlockView } from '../../schema/block-view';
import type { Drawing } from '../../schema/drawing';
import DrawnBlock from './DrawnBlock.svelte';

export function drawnView(drawing: Drawing): BlockView {
	return asBlockView({ drawing, host: DrawnBlock }, 'drawn');
}
