/**
 * CommonMark's 32 escapable ASCII punctuation characters (§2.4). A core leaf because both the
 * inline scanner and the block-level link-reference parser (§4.7) need it, and neither should
 * import the other's directory to reach a lexical constant.
 */
export const ESCAPABLE_PUNCTUATION = new Set('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~');
