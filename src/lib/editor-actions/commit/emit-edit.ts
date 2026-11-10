/**
 * The one place `edit` is emitted: the editor's link definitions are brought up to date from the
 * blocks the write replaced first, so every subscriber reads current references.
 */

import type { NodeView } from '../../core/node-views';
import type { EditEvent, EditorEvents } from '../../editor-events';

/** The blocks a write took out of the document and put in, at whatever depth it read them, or
 *  `'unknown'` where the route can't name them. */
export type ReplacedBlocks =
	'unknown' | { readonly before: readonly NodeView[]; readonly after: readonly NodeView[] };

export const NOTHING_REPLACED: ReplacedBlocks = { before: [], after: [] };

export function emitEdit(
	deps: { events: EditorEvents; refreshDefinitions(replaced: ReplacedBlocks): void },
	event: EditEvent,
	replaced: ReplacedBlocks
): void {
	deps.refreshDefinitions(replaced);
	deps.events.emit('edit', event);
}
