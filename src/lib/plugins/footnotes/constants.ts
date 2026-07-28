/** The footnote block-kind name — a plain string so the numbering walk can skip
 *  definition blocks without importing the branded declaration. */
export const FOOTNOTE_DEF_KIND = 'footnote-def';

/** The footnote-reference inline-kind name, shared by the recognizer that mints
 *  the node and the numbering walk that filters for it. */
export const FOOTNOTE_REF_KIND = 'footnote-ref';
