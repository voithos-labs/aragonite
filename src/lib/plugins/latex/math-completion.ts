/**
 * Block math's Enter completer: a lone `$$` line completes into the open fence, an empty body and
 * the closer, with the caret on the body. Registered beside the kind, so with no extension loaded
 * `$$` plus Enter still splits exactly as bare GFM does.
 */

import {
	registerBlockCompleter,
	trimWhitespace,
	type AnyBlockKind,
	type CompletionResult
} from '$lib/plugin';
import { isMathFenceLine, mathBlockLines } from './math-shape';

/** Exactly the fence and nothing else: `$$x$$` is already a whole block and `$$ x` opens no
 *  multi-line form, so neither is an attempt at the pair this completes. */
export function tryCompleteMathBlock(line: string): CompletionResult | null {
	if (!isMathFenceLine(trimWhitespace(line))) return null;
	return { lines: mathBlockLines(''), caret: { path: [], line: 1, column: 0 } };
}

export function registerMathBlockCompleter(kind: AnyBlockKind): void {
	// On typing as well as on Enter: a lone `$$` can only be the pair's opener, so the block
	// forms as the second `$` is typed, the way a typed ` ``` ` becomes a fence at once.
	registerBlockCompleter(kind, { tryComplete: tryCompleteMathBlock, onType: true });
}
