/**
 * The keys a pending break answers first in a text block, ahead of the edge step and every other
 * key handler: a typed character lands on the open line, and a key that moves the caret or deletes
 * ends the line first. Backspace and ArrowLeft stop there, at the end of the text above.
 */

import type { ContentWrite } from '../../../action-contracts';
import type { BlockPendingBreak } from '../../../cursor/pending-break.svelte';
import { classifyArrivalKey } from '../../../cursor/edge-affinity';
import { BARE_MODIFIER_KEYS } from '../../../schema/keybindings';
import type { TextWrite } from '../surface-write';
import { hasModifier, isPlainTypingKey } from './click-snap-guard';

export interface PendingBreakKeyDeps {
	pendingBreak: BlockPendingBreak;
	/** The collapsed caret's raw offset, or null for a range. */
	getCaret(): number | null;
	getDisplayText(): string;
	/** Marks a toggle promised the next byte: their own key handler writes it, and that write
	 *  spends the break too. */
	hasPendingMarks(): boolean;
	/** Whether the key is Shift+Enter's command here, which opens one more line. */
	opensBreak(e: KeyboardEvent): boolean;
	writeText(write: TextWrite): ContentWrite;
	requestCaret(at: number): void;
}

/** True when the key was handled here, its default prevented. */
export function handlePendingBreakKey(e: KeyboardEvent, deps: PendingBreakKeyDeps): boolean {
	const at = deps.pendingBreak.at();
	if (at === null || e.isComposing || BARE_MODIFIER_KEYS.includes(e.key)) return false;
	if (deps.opensBreak(e)) return false;
	if (isPlainTypingKey(e)) {
		if (deps.getCaret() !== at) {
			deps.pendingBreak.end();
			return false;
		}
		if (deps.hasPendingMarks()) return false;
		e.preventDefault();
		const text = deps.getDisplayText();
		void deps.writeText({
			text: text.slice(0, at) + e.key + text.slice(at),
			caretAfter: at + e.key.length,
			intent: 'typed',
			mode: 'authored',
			source: 'pending-break'
		});
		return true;
	}
	const arrival = classifyArrivalKey(e.key, e.metaKey);
	const deletes = e.key === 'Backspace' || e.key === 'Delete';
	// A key that neither moves the caret nor deletes (Tab, Enter, a chord) leaves the line to
	// whatever it writes, which spends it or ends it.
	if (!deletes && (arrival === 'preserve' || arrival === 'reset')) return false;
	deps.pendingBreak.end();
	const stepsBack = e.key === 'Backspace' || e.key === 'ArrowLeft';
	if (!stepsBack || e.shiftKey || hasModifier(e)) return false;
	e.preventDefault();
	deps.requestCaret(at);
	return true;
}
