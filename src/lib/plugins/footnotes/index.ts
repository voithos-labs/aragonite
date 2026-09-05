export { footnotesPlugin } from './footnotes-plugin';
export { FOOTNOTE_DEF_KIND, FOOTNOTE_REF_KIND } from './constants';
// `footnoteNumbersFor` is deliberately absent: only a mounted widget can supply its
// content-version argument, and `InlineWidgetComponentProps.getContentVersion` is the
// reusable half of that recipe.
export { assignFootnoteNumbers, collectFootnoteReferences } from './footnote-numbering';
export type { FootnoteReference } from './footnote-numbering';
export type { FootnoteDefMetadata } from './footnote-definition';
