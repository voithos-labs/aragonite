export { footnotesPlugin } from './footnotes-plugin';
export { FOOTNOTE_DEF_KIND, FOOTNOTE_REF_KIND } from './constants';
// `footnoteNumbersFor` stays unexported: only a mounted widget can supply its content version,
// through `InlineWidgetComponentProps.getContentVersion`.
export { assignFootnoteNumbers, collectFootnoteReferences } from './footnote-numbering';
export type { FootnoteReference } from './footnote-numbering';
export type { FootnoteDefMetadata } from './footnote-definition';
