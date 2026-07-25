/**
 * The one door the paste gates reach a kind's `containerPaste` declaration
 * through. `matchesAncestor` is plugin code run on a user gesture, and on the
 * cross-block route the covering range delete has already committed by the time
 * a gate consults it — an escaping throw leaves the selection deleted, nothing
 * pasted, and the consumer's error seam silent. Resolving here hands back a
 * declaration whose predicate is already contained, so the raw one is
 * unreachable from the three gates that share this rule.
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
				// Decline — the same answer a `false` return gives, so a broken
				// predicate degrades the paste to the generic structural path at every
				// gate instead of aborting mid-gesture.
				devWarn('container-paste', `matchesAncestor threw for kind "${kind}"`, error);
				return false;
			}
		}
	};
}
