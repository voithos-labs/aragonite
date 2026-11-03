/** Whether a keypress is the chord that opens the link card, resolved at the block the open card
 *  edits, so a consumer's rebinding of it is the one the card swallows. */

import type { Document } from '../../core/nodes';
import type { CommandDispatchContext } from '../../schema/block-commands';
import { commandForKey } from '../../schema/commands';
import { blockNodeAt } from '../../tree-operations/node-primitives';
import type { LinkCardState } from './link-card-state.svelte';

export function opensLinkCard(
	e: KeyboardEvent,
	card: Pick<LinkCardState, 'getTarget' | 'getCreateTarget'>,
	doc: Document,
	commands: Pick<CommandDispatchContext, 'keybindingOverrides' | 'activation'>
): boolean {
	const path = card.getTarget()?.path ?? card.getCreateTarget()?.path;
	const kind = path ? (blockNodeAt(doc, path)?.kind ?? null) : null;
	return commandForKey(e, kind, commands) === 'link.openCard';
}
