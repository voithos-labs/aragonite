export { footnotesPlugin } from './footnotes-plugin';
export { FOOTNOTE_DEF_KIND, FOOTNOTE_REF_KIND } from './constants';
// `footnoteNumbersFor` is deliberately absent: only a widget the editor mounted can
// supply its content-version argument, and the reusable half of that recipe is the
// version itself (`InlineWidgetComponentProps.getContentVersion`), not this map.
export { assignFootnoteNumbers, collectFootnoteReferences } from './footnote-numbering';
export type { FootnoteReference } from './footnote-numbering';
export type { FootnoteDefMetadata } from './footnote-definition';
