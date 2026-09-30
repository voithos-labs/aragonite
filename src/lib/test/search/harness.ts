/**
 * The dependencies `createSearchState` needs, built once; whatever a suite does differently (a
 * generation getter that counts, a swapped document, an executor held open, a real replace)
 * comes in as an option.
 */

import { parse } from '../../core/parser';
import { createDecorationEngine } from '../../decorations/decoration-state.svelte';
import { createSearchState } from '../../search/search-state.svelte';
import type { RegexExecutor } from '../../search/regex-executor';
import type { Match } from '../../search/document-scan';
import type { Document } from '../../core/nodes';

export interface ReplaceStub {
	replaceOne(m: Match, text: string): Promise<number>;
	replaceAll(ms: Match[], text: string): Promise<number>;
}

export const stubReplace: ReplaceStub = { replaceOne: async () => 0, replaceAll: async () => 0 };

export interface SearchHarnessOptions {
	replace?: ReplaceStub | undefined;
	regexExecutor?: RegexExecutor | undefined;
	/** A live document to use instead, for the swap suites; defaults to the parsed `source`. */
	getDoc?: (() => Document) | undefined;
	getDocumentGeneration?: (() => number) | undefined;
	onClose?: (() => void) | undefined;
}

export function makeSearchHarness(source: string, opts: SearchHarnessOptions = {}) {
	const doc = parse(source);
	const getDoc = opts.getDoc ?? (() => doc);
	const engine = createDecorationEngine({ getDoc });
	const state = createSearchState({
		getDoc,
		getDocumentGeneration: opts.getDocumentGeneration ?? (() => 0),
		decorations: engine,
		replace: opts.replace ?? stubReplace,
		reveal: async () => null,
		...(opts.regexExecutor ? { regexExecutor: opts.regexExecutor } : {}),
		onClose: opts.onClose ?? (() => {})
	});
	return { doc, engine, state };
}
