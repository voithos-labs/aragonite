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
 *  multi-line form, so neither is a gesture toward the pair this completes. */
export function tryCompleteMathBlock(line: string): CompletionResult | null {
	if (line.trim() !== BLOCK_FENCE) return null;
	return { lines: [BLOCK_FENCE, '', BLOCK_FENCE], caret: { path: [], line: 1, column: 0 } };
}

export function registerMathBlockCompleter(kind: AnyBlockKind): void {
	if (isBlockCompleterRegistered(kind)) return;
	// On type as well as at Enter: a lone `$$` can only be the pair's opener, so the block forms
	// as the second `$` lands — the way a typed ` ``` ` is a fence at once — with the caret on
	// the body line. The one-line `$$x$$` form is still reachable by typing into that body.
	registerBlockCompleter(kind, { tryComplete: tryCompleteMathBlock, onType: true });
}
