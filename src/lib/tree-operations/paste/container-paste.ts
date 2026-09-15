/**
 * The one place the paste checks read a kind's `containerPaste` declaration through.
 * `matchesAncestor` is plugin code, and on the cross-block route the covering range delete
 * has already committed when a check consults it, so an escaping throw would leave the
 * selection deleted and nothing pasted. The returned declaration already catches it.
 */

import type { AnyBlockKind } from '../../core/nodes';
import type { BlockKindDescriptor } from '../../schema/block-kind-descriptor';
import { tryGetBlockKindDescriptor } from '../../schema/block-kind-descriptor';
import { devWarn } from '../../dev-warn';

export type ContainerPasteDeclaration = NonNullable<BlockKindDescriptor['containerPaste']>;

export function containerPasteFor(kind: AnyBlockKind): ContainerPasteDeclaration | undefined {
	const declared = tryGetBlockKindDescriptor(kind)?.containerPaste;
	if (!declared) return undefined;
	return {
		siblingAbsorb: declared.siblingAbsorb,
		matchesAncestor: (clipboardTop, ancestor) => {
			try {
				return declared.matchesAncestor(clipboardTop, ancestor);
			} catch (error) {
				// Decline, so a broken predicate degrades the paste to the generic structural
				// path rather than aborting mid-gesture.
				devWarn('container-paste', `matchesAncestor threw for kind "${kind}"`, error);
				return false;
			}
		}
	};
}
