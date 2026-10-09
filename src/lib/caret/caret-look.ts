/**
 * What the drawn caret shows: the formats the next typed letter would carry, so a bold caret means
 * the letter types bold. The answer comes from the typing path itself
 * (`components/blocks/text/next-byte.ts`); the stylesheet draws one shape per mark kind.
 */

import type { InlineMarkKind } from '../schema/inline-construct-policy';

/** The constructs with a format chord the next typed letter would sit inside, outermost first. */
export interface NextByte {
	readonly marks: readonly InlineMarkKind[];
}

/** The look the drawn caret paints. */
export interface CaretLook {
	readonly marks: readonly InlineMarkKind[];
}

/** The look for `next`: inline code included, which no shape draws, so the attribute stays whole. */
export function caretLook(next: NextByte): CaretLook {
	return { marks: next.marks };
}
