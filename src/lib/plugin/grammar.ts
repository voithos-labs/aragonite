// The text helpers a plugin's own grammar reads with, published at
// `@voithos-labs/aragonite/plugin/grammar`: GFM's line and whitespace rules, so a plugin's reading
// of its bytes agrees with the editor's. Nothing here is frozen before 1.0.

// A CRLF document stays CRLF: split on the endings it has, and write the one its first line has.
export { splitLines, firstLineEnding } from '../core/lines';
export type { LineEnding, ParsedLine } from '../core/lines';
// GFM §2.1's blank line and whitespace. `String.trim()` and JS `\s` would also take a
// non-breaking space, which is content.
export { isBlankText, isWhitespaceChar, trimWhitespace } from '../core/lines';
// The Unicode whitespace emphasis reads beside a delimiter, for a plugin's own delimiter run.
export { isUnicodeWhitespace } from '../core/inline/scan/chars';
// CommonMark's type-6 tag line for one tag name (`<details>`).
export { htmlBlockTagLineMatcher } from '../core/parsers/html-block';
// The fence or `:::` run that wraps a body so no line of it closes the block.
export { escalatedRun } from '../core/escalated-run';
