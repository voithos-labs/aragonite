// The grammar an editor running only `details` reads with, for the package's suites that read its
// documents into the syntax tree; make one inside each test, after the platform reset.
import { listGrammar } from '#lib/schema/own-syntax.js';
import type { GrammarView } from '#lib/schema/block-openers.js';
import { details } from '#packages/details/src/index.js';

export const DETAILS = 'details/details';
export const SUMMARY = 'details/details.title';

/** What an editor listing only `details` installs: its grammar and its contributions. */
export function detailsList() {
	return listGrammar([details], ({ cause }) => {
		throw cause;
	});
}

export function detailsGrammar(): GrammarView {
	return detailsList().grammar;
}
