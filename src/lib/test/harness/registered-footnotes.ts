/**
 * Footnotes registered through the process-wide registrars, for the suites that read with the
 * page's grammar (`parse(source)`, `installPlugins`) and take a footnote as their indented container
 * (`[^label]:`, kind `footnote-def`) or their plugin inline widget (`[^label]`, kind `footnote-ref`).
 * These are the footnotes package as it was before it became a plugin value (`./footnotes/`); the
 * package's own rows are under `test/plugins/footnotes/`.
 */
export { footnotesPlugin as registeredFootnotes } from './footnotes/footnotes-plugin';
export { FOOTNOTE_DEF_KIND, FOOTNOTE_REF_KIND } from './footnotes/constants';
export {
	assignFootnoteNumbers,
	collectFootnoteReferences,
	footnoteNumbersFor
} from './footnotes/footnote-numbering';
export {
	registerFootnoteDefinition,
	type FootnoteDefMetadata
} from './footnotes/footnote-definition';
export { registerFootnoteReference } from './footnotes/footnote-reference';
export { default as FootnoteDefinitionView } from './footnotes/FootnoteDefinition.svelte';
