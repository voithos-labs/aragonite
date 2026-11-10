// When to rebuild the link reference definition map, and the counter that render caches key on.

import type { Document } from '../core/nodes';
import { definitionsOf, type LinkDefinitions } from '../core/inline/scan/definitions';
import type { ReplacedBlocks } from '../editor-actions/commit/emit-edit';
import { assertDefinitionsKept } from '../invariants/install';

/** Keeps the whole-document rebuild off every write that took out and put in no definition, a
 *  keystroke in a paragraph above all. */
export function lrdMapCouldChange(replaced: ReplacedBlocks): boolean {
	if (replaced === 'unknown') return true;
	return definitionsOf([...replaced.before, ...replaced.after]).signature !== '';
}

/** The definitions after a write that replaced `replaced`; null where they can't have changed
 *  from those `signature` names, which dev checks. */
export function definitionsAfter(
	doc: Document,
	replaced: ReplacedBlocks,
	signature: string
): LinkDefinitions | null {
	if (lrdMapCouldChange(replaced)) return definitionsOf(doc.children);
	assertDefinitionsKept(doc.children, signature);
	return null;
}

/** Changes exactly when the signature does: render caches key on it rather than the (~MB)
 *  signature, and a bump per rebuild would re-render every block with a bracket in it. */
export function advanceSignatureEpoch(
	prevSignature: string,
	prevEpoch: number,
	nextSignature: string
): { signature: string; epoch: number } {
	if (nextSignature === prevSignature) return { signature: prevSignature, epoch: prevEpoch };
	return { signature: nextSignature, epoch: prevEpoch + 1 };
}
