/**
 * The keys a pending break answers first in a text block, ahead of every other key handler: a
 * typed character lands on the open line, and Backspace, ArrowLeft and Delete take the line back
 * and stop at the end of the text above. Any other key moves from the open line, which
 * ends once the caret leaves it (`caretOnPendingBreakLine`).
 */

import type { ContentWrite } from '../../../action-contracts';
import type { BlockPendingBreak } from '../../../caret/pending-break.svelte';
import { BARE_MODIFIER_KEYS, caretEdgeKey } from '../../../schema/keybindings';
import type { TextWrite } from '../editable/surface-write';
import { hasModifier, isPlainTypingKey } from './click-snap-guard';

export interface PendingBreakKeyDeps {
	pendingBreak: BlockPendingBreak;
	/** The collapsed caret's raw offset, or null for a range. */
	getCaret(): number | null;
	getDisplayText(): string;
	/** Whether the key is Shift+Enter's command here, which opens one more line. */
	opensBreak(e: KeyboardEvent): boolean;
	writeText(write: TextWrite): ContentWrite;
	requestCaret(at: number): void;
}

/** True when the key was handled here, its default prevented. */
export function handlePendingBreakKey(e: KeyboardEvent, deps: PendingBreakKeyDeps): boolean {
	const at = deps.pendingBreak.at();
	if (at === null || BARE_MODIFIER_KEYS.includes(e.key)) return false;
	if (deps.opensBreak(e)) return false;
	if (isPlainTypingKey(e)) {
		if (deps.getCaret() !== at) {
			deps.pendingBreak.end();
			return false;
		}
		e.preventDefault();
		const text = deps.getDisplayText();
		void deps.writeText({
			text: text.slice(0, at) + e.key + text.slice(at),
			caretAfter: at + e.key.length,
			intent: 'typed',
			history: 'join-typing',
			mode: 'authored',
			source: 'pending-break'
		});
		return true;
	}
	const edge = caretEdgeKey(e);
	// The open line holds no text, so its line's edges are where the caret already is.
	if (edge?.to === 'line') {
		e.preventDefault();
		return true;
	}
	const stepsBack = e.key === 'Backspace' || (e.key === 'ArrowLeft' && edge === null);
	if (!stepsBack && e.key !== 'Delete') return false;
	// Shift+Backspace is Backspace on every OS; Shift+ArrowLeft extends a selection. The open line
	// holds no bytes, so every Delete takes it back rather than joining the next block.
	const extending = e.shiftKey && e.key === 'ArrowLeft';
	if (e.key !== 'Delete' && (extending || hasModifier(e))) {
		deps.pendingBreak.end();
		return false;
	}
	e.preventDefault();
	takeBackOpenLine(deps);
	return true;
}

/** Takes the open line back, the caret left at the end of the text above: Backspace, ArrowLeft or
 *  Delete on the line, or a soft keyboard's delete there. False when no line is open. */
export function takeBackOpenLine(
	deps: Pick<PendingBreakKeyDeps, 'pendingBreak' | 'requestCaret'>
): boolean {
	const at = deps.pendingBreak.at();
	if (at === null) return false;
	deps.pendingBreak.end();
	deps.requestCaret(at);
	return true;
}
