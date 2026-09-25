/**
 * The reading a kit gives the editor parts it builds without mounting an editor: every installed
 * plugin's syntax, no link-reference definitions, and a mode the caller may set.
 */

import { hidesDelimitersAtCaret, type PresentationMode } from '../presentation-mode';
import { defaultGrammarView } from '../schema/block-openers';
import type { Reading } from '../schema/reading';

export function kitReading(mode: () => PresentationMode = () => 'source'): Reading {
	return {
		grammar: defaultGrammarView,
		current: undefined,
		signature: '',
		epoch: 0,
		mode,
		hidesDelimitersAtCaret: () => hidesDelimitersAtCaret(mode())
	};
}
