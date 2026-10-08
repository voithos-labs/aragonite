// Shared drivers for the search-replace suites: the deps + bundle assembly and the
// real compile-then-scan pipeline.

import { parse } from '#lib/core/parser.js';
import type { CstNode, Document } from '#lib/core/nodes.js';
import { compileMatcher, type MatcherOptions } from '#lib/search/matcher.js';
import { scanDocument } from '#lib/search/document-scan.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { createSearchReplace } from '#lib/editor-actions/search-replace.js';
import { makeEditorActionsDeps, type EditorActionsHarness } from './editor-actions';

export interface SearchReplaceHarness extends EditorActionsHarness {
	sr: ReturnType<typeof createSearchReplace>;
}

export function makeSearchReplace(
	input: string | CstNode[] | Document,
	options: Parameters<typeof makeEditorActionsDeps>[1] = {}
): SearchReplaceHarness {
	const harness = makeEditorActionsDeps(typeof input === 'string' ? parse(input) : input, options);
	return { ...harness, sr: createSearchReplace(harness.deps, createUndoController(harness.deps)) };
}

/** The real scanner over a compiled query; throws so a bad fixture query fails loudly. */
export function scanCompiled(doc: Document, query: string, opts: Partial<MatcherOptions> = {}) {
	const compiled = compileMatcher(query, {
		caseSensitive: opts.caseSensitive ?? false,
		wholeWord: opts.wholeWord ?? false,
		regex: opts.regex ?? false
	});
	if (!compiled.ok) throw new Error(compiled.error);
	return scanDocument(doc, compiled.matcher);
}
