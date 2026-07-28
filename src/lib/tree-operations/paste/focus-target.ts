/**
 * Where the caret lands after a structural paste. Single-sourced so every
 * structural route skips the reattached residue identically: the divergence
 * this replaced landed two routes (list break-out, container-match merge) on the
 * residue's end instead of the pasted content's, for the same logical paste.
 *
 * The rule is only shareable for routes whose residue is a SEPARATE node in a
 * `[prefix?, ...pasted, residue?]` replacement — a block-index landing. A route
 * that reattaches the residue INSIDE the last pasted leaf lands at a char offset
 * within that leaf (a different coordinate space) and computes its own target.
 */

/**
 * Focus index for a `[prefix?, ...pasted, residue?]` replacement: the last
 * PASTED node. A trailing residue node shifts the target one node earlier
 * (`length - 2`); without it, the last node (`length - 1`). Clamped so a
 * degenerate single-node replacement stays in range.
 */
export function focusIndexBeforeResidue(replacementLength: number, hasResidue: boolean): number {
	return hasResidue && replacementLength >= 2 ? replacementLength - 2 : replacementLength - 1;
}
