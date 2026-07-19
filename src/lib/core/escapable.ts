/**
 * CommonMark's 32 escapable ASCII punctuation characters (§2.4).
 *
 * A core leaf rather than an inline-parser module: both phases need it — the
 * inline scanner for `\`-escapes, and the block-level link-reference parser for
 * escaped brackets inside a label (§4.7). It lives here so neither has to import
 * the other's directory to reach a lexical constant, and so the two cannot drift
 * (they were two byte-identical copies).
 */
export const ESCAPABLE_PUNCTUATION = new Set('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~');
