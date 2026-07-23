// Footnotes plugin — public entry. `footnotesPlugin()` teaches the editor the GFM
// `[^label]: content` definition container and the `[^label]` inline reference;
// `assignFootnoteNumbers` is the derived first-reference-order numbering seam the
// reference widget reads.
export { footnotesPlugin } from './footnotes-plugin';
export { FOOTNOTE_DEF_KIND, FOOTNOTE_REF_KIND } from './constants';
export { assignFootnoteNumbers, collectFootnoteReferences } from './footnote-numbering';
export type { FootnoteReference } from './footnote-numbering';
export type { FootnoteDefMetadata } from './footnote-definition';
