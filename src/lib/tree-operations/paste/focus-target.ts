/**
 * Focus index for a `[prefix?, ...pasted, residue?]` replacement: the last PASTED node.
 * Single-sourced so every structural route skips the reattached residue identically.
 * Applies only where the residue is a SEPARATE node; a route that reattaches it inside the
 * last pasted leaf lands at a char offset in a different coordinate space.
 */
export function focusIndexBeforeResidue(replacementLength: number, hasResidue: boolean): number {
	return hasResidue && replacementLength >= 2 ? replacementLength - 2 : replacementLength - 1;
}
