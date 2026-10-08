/**
 * The keys a pending break answers first in a text block, ahead of every other key handler: a
 * typed character lands on the open line, Backspace and ArrowLeft take the line back and stop at
 * the end of the text above, and Delete ends it. Any other key moves from the open line, which
 * ends once the caret leaves it (`caretOnPendingBreakLine`).
 */

import type { ContentWrite } from '../../../action-contracts';
import type { BlockPendingBreak } from '../../../caret/pending-break.svelte';
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
	const stepsBack = e.key === 'Backspace' || e.key === 'ArrowLeft';
	if (!stepsBack && e.key !== 'Delete') return false;
	deps.pendingBreak.end();
	if (!stepsBack || e.shiftKey || hasModifier(e)) return false;
	e.preventDefault();
	deps.requestCaret(at);
	return true;
}
