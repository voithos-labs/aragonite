/**
 * G1.206: a write that said it replaced no link definition leaves the document's definitions as
 * they were, so the editor was right to keep its resolver. Past {@link DEFINITIONS_CHECK_LIMIT}
 * bytes it says nothing, so a keystroke in a long document stays cheap in dev.
 */

import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';
import { definitionsOf } from '../core/inline/scan/definitions';
import type { CstNode } from '../core/nodes';

export const DEFINITIONS_CHECK_LIMIT = 65_536;

export function checkDefinitionsKept(
	children: readonly CstNode[],
	signature: string
): InvariantViolation | null {
	let bytes = 0;
	for (const child of children) bytes += child.leadingTrivia.length + child.raw.length;
	if (bytes > DEFINITIONS_CHECK_LIMIT) return null;
	if (definitionsOf(children).signature === signature) return null;
	return { code: 'definitions-kept', message: 'a write that replaced no definition changed them' };
}
