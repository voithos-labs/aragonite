// The grammar an editor running only `footnotes` reads with, for the package's suites that read its
// documents into the syntax tree; make one inside each test, after the platform reset.
import { listGrammar } from '#lib/schema/own-syntax.js';
import type { GrammarView } from '#lib/schema/block-openers.js';
import { footnotes } from '#packages/footnotes/src/index.js';

export const DEFINITION = 'footnotes/definition';
export const REFERENCE = 'footnotes/ref';

export function footnotesGrammar(): GrammarView {
	return listGrammar([footnotes], ({ cause }) => {
		throw cause;
	}).grammar;
}
