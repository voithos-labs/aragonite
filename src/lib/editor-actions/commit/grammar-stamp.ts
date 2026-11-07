/**
 * The grammar an undo entry's tree was read under, and whether the editor still reads it: an entry
 * restored under another has its bytes read again.
 */

import type { GrammarView } from '../../schema/block-openers';
import type { GrammarStamp } from '../../undo/types';

export function grammarStamp(grammar: GrammarView): GrammarStamp {
	return { openers: grammar.orderedOpeners(), setextHeading: grammar.setextHeading };
}

/** Compared opener by opener, since a grammar builds a new list whenever its plugins change, even
 *  back to the same ones. */
export function sameGrammar(a: GrammarStamp, b: GrammarStamp): boolean {
	if (a.setextHeading !== b.setextHeading || a.openers.length !== b.openers.length) return false;
	return a.openers === b.openers || a.openers.every((opener, i) => opener === b.openers[i]);
}
