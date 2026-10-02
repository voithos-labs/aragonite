// What the occurrence scan counts as part of a word. A module of its own, with no imports, so the
// e2e specs can read it in Node without loading the plugin API.

// Astral-plane text falls outside "word" here, which is honest enough for a reference plugin.
export const WORD_CHAR = /[\p{L}\p{N}_]/u;
