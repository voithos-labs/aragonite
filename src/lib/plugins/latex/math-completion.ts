/**
 * Block math's Enter completer: a lone `$$` line completes into the open fence, an empty body and
 * the closer, with the caret on the body. Registered beside the kind, so with no extension loaded
 * `$$` plus Enter still splits exactly as bare GFM does.
 */

import {
	isBlockCompleterRegistered,
	registerBlockCompleter,
	type AnyBlockKind,
	type CompletionResult
} from '$lib/plugin';

const BLOCK_FENCE = '$$';

/** Exactly the fence and nothing else: `$$x$$` is already a whole block and `$$ x` opens no
 *  multi-line form, so neither is an attempt at the pair this completes. */
export function tryCompleteMathBlock(line: string): CompletionResult | null {
	if (line.trim() !== BLOCK_FENCE) return null;
	return { lines: [BLOCK_FENCE, '', BLOCK_FENCE], caret: { path: [], line: 1, column: 0 } };
}

export function registerMathBlockCompleter(kind: AnyBlockKind): void {
	if (isBlockCompleterRegistered(kind)) return;
	// On typing as well as on Enter: a lone `$$` can only be the pair's opener, so the block
	// forms as the second `$` is typed, the way a typed ` ``` ` becomes a fence at once.
	registerBlockCompleter(kind, { tryComplete: tryCompleteMathBlock, onType: true });
}
