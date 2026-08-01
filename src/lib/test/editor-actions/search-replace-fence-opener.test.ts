import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import type { Document } from '$lib/core/nodes';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createSearchReplace } from '$lib/editor-actions/search-replace';
import { compileMatcher } from '$lib/search/matcher';
import { scanDocument } from '$lib/search/document-scan';
import { expectParseConverged } from '../harness/parse-converged';
import { makeEditorActionsDeps } from '../harness/editor-actions';

// Find/replace is the one byte sink whose write can take a code block's OPENER without a
// selection endpoint: a match spanning the opener line substitutes it away and strands the
// closer, which then absorbs the heading below (issue #58). Miss-analysis:
// `search-replace-fence-escalation.test.ts` drove matches that end ON the closer (issue #55) and
// none that start above the opener, so this door's other half went unwatched.

function makeDoc(source: string) {
	const { deps } = makeEditorActionsDeps(parse(source).children);
	return { deps, replace: createSearchReplace(deps, createUndoController(deps)) };
}

function scan(doc: Document, query: string) {
	const compiled = compileMatcher(query, { caseSensitive: true, wholeWord: false, regex: false });
	if (!compiled.ok) throw new Error(compiled.error);
	return scanDocument(doc, compiled.matcher);
}

const BACKTICKS = '```';

describe('search/replace that consumes a fenced code opener', () => {
	it('drops the closer a replacement over the opener and body stranded', async () => {
		const { deps, replace } = makeDoc('```js\nbody\n```\n\n# Heading\n');

		await replace.replaceAll(scan(deps.doc, `${BACKTICKS}js\nbody`), 'x');

		expect(serialize(deps.doc)).toBe('x\n\n# Heading\n');
		expect(deps.doc.children.map((c) => c.kind)).toEqual(['paragraph', 'heading']);
		expectParseConverged(deps.doc);
	});

	it('drops it when the match is the opener line alone', async () => {
		const { deps, replace } = makeDoc('```js\nbody\n```\n\n# Heading\n');

		await replace.replaceAll(scan(deps.doc, `${BACKTICKS}js\n`), '');

		expect(serialize(deps.doc)).toBe('body\n\n# Heading\n');
		expectParseConverged(deps.doc);
	});

	// A replacement can also push text ABOVE the opener, which leaves line 0 foreign while the
	// opener still claims the closer below it. Dropping that run would unclose a live block.
	it('leaves a closer an opener above it still claims', async () => {
		const { deps, replace } = makeDoc('```js\nbody\n```\n\n# Heading\n');

		await replace.replaceAll(scan(deps.doc, `${BACKTICKS}js`), `x\n${BACKTICKS}js`);

		expect(serialize(deps.doc)).toBe('x\n```js\nbody\n```\n\n# Heading\n');
		expect(deps.doc.children.map((c) => c.kind)).toEqual(['paragraph', 'fencedCode', 'heading']);
		expectParseConverged(deps.doc);
	});
});
