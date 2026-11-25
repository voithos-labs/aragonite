// The grammar an editor running only `admonitions` reads with, for the package's suites that read
// its documents into the syntax tree; make one inside each test, after the platform reset.
import { listGrammar } from '#lib/schema/own-syntax.js';
import type { GrammarView } from '#lib/schema/block-openers.js';
import { admonitions } from '#packages/admonitions/src/index.js';

export const ADMONITION = 'admonitions/admonition';
export const ALERT = 'admonitions/alert';

export function admonitionsGrammar(): GrammarView {
	return listGrammar([admonitions], ({ cause }) => {
		throw cause;
	}).grammar;
}
