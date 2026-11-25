/**
 * Footnotes registered through the process-wide registrars, for the suites that read with the
 * page's grammar (`parse(source)`, `installPlugins`) and take a footnote as their indented container
 * (`[^label]:`, kind `footnote-def`) or their plugin inline widget (`[^label]`, kind `footnote-ref`).
 */
export {
	footnotesPlugin as registeredFootnotes,
	FOOTNOTE_DEF_KIND,
	FOOTNOTE_REF_KIND,
	assignFootnoteNumbers,
	collectFootnoteReferences
} from '#packages/footnotes/src/index.js';
export {
	registerFootnoteDefinition,
	type FootnoteDefMetadata
} from '#packages/footnotes/src/footnote-definition.js';
export { registerFootnoteReference } from '#packages/footnotes/src/footnote-reference.js';
export { footnoteNumbersFor } from '#packages/footnotes/src/footnote-numbering.js';
export { default as FootnoteDefinitionView } from '#packages/footnotes/src/FootnoteDefinition.svelte';
