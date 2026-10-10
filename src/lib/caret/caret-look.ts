/**
 * What the drawn caret shows: the formats the next typed letter would carry, so a bold caret means
 * the letter types bold. The answer comes from the typing path itself
 * (`components/blocks/text/next-byte.ts`); the stylesheet draws one shape per mark kind.
 */

import { getInlineConstructPolicy, type InlineMarkKind } from '../schema/inline-construct-policy';

/** The constructs with a format chord the next typed letter would sit inside, outermost first:
 *  their kinds, and each one by kind and start offset, which a letter typed inside it doesn't move. */
export interface NextByte {
	readonly marks: readonly InlineMarkKind[];
	readonly holders: readonly { readonly kind: InlineMarkKind; readonly start: number }[];
}

/** The look the drawn caret paints. */
export interface CaretLook {
	readonly marks: readonly InlineMarkKind[];
	/** The letter lands inside a construct with a painted box, so at that box's edge the bar draws
	 *  inside its border. */
	readonly boxed: boolean;
}

/** The look for `next`: inline code included, which no shape draws, so the attribute stays whole. */
export function caretLook(next: NextByte): CaretLook {
	const boxed = next.marks.some((kind) => getInlineConstructPolicy(kind)?.edgeAffinity === 'boxed');
	return { marks: next.marks, boxed };
}
