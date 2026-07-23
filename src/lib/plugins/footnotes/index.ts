// Footnotes plugin — public entry. `footnotesPlugin()` teaches the editor the
// GFM `[^label]: content` definition container; `assignFootnoteNumbers` is the
// derived-numbering seam the reference side consumes.
export { footnotesPlugin } from './footnotes-plugin';
export { FOOTNOTE_DEF_KIND } from './constants';
export { assignFootnoteNumbers, collectFootnoteReferences } from './footnote-numbering';
export type { FootnoteReference } from './footnote-numbering';
export type { FootnoteDefMetadata } from './footnote-definition';
