/**
 * The red wave under each misspelled word of a block of text, but the word being typed. Every
 * paint hands its marks the same handlers, so a block painted again with the same words keeps
 * its marks as they were.
 */

import type { Block, MarkAt, Paint } from '@voithos-labs/aragonite/plugin';
import type { TypingWord } from './typing-word';
import type { Verdicts } from './verdicts';
import { wordSpans } from './words';

/** The class every wave's mark carries, which `spellcheck.css` draws. */
export const WAVE_CLASS = 'spell-overlay';

export interface WaveHandlers {
	hover?(at: MarkAt | null): void;
	activate?(at: MarkAt): void;
}

export function paintWaves(
	block: Block,
	verdicts: Verdicts,
	typing: TypingWord,
	handlers: WaveHandlers = {}
): Paint[] {
	const spans = wordSpans(block);
	if (spans.length === 0) return [];
	// Asked before the marks are built, so a dictionary that answers at once paints in this pass.
	verdicts.ask(spans.map((span) => span.word));
	const marks: Paint[] = [];
	for (const { from, to, word } of spans) {
		if (!verdicts.misspelled(word) || typing.holds(from)) continue;
		marks.push({ type: 'mark', from, to, class: WAVE_CLASS, ...handlers });
	}
	return marks;
}
