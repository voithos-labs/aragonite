import { describe, it, expect } from 'vitest';
import { serialize } from '#lib/core/serializer.js';
import type { Document } from '#lib/core/nodes.js';
import { expectParseConverged } from '#lib/test/harness/parse-converged.js';
import { makeSearchReplace, scanCompiled } from '#lib/test/harness/search-replace.js';

// Find and replace is the one write that can take a code block's opener without a selection
// endpoint: a match spanning the opener line substitutes it away and strands the closer,
// which then absorbs the heading below.
// Miss-analysis (GH #58): replace tests drove matches ending on the closer, never above the opener.

const scan = (doc: Document, query: string) => scanCompiled(doc, query, { caseSensitive: true });

const BACKTICKS = '```';

describe('search/replace that consumes a fenced code opener', () => {
	it('drops the closer a replacement over the opener and body stranded', async () => {
		const { deps, sr } = makeSearchReplace('```js\nbody\n```\n\n# Heading\n');

		await sr.replaceAll(scan(deps.doc, `${BACKTICKS}js\nbody`), 'x');

		expect(serialize(deps.doc)).toBe('x\n\n# Heading\n');
		expect(deps.doc.children.map((c) => c.kind)).toEqual(['paragraph', 'heading']);
		expectParseConverged(deps.doc);
	});

	it('drops it when the match is the opener line alone', async () => {
		const { deps, sr } = makeSearchReplace('```js\nbody\n```\n\n# Heading\n');

		await sr.replaceAll(scan(deps.doc, `${BACKTICKS}js\n`), '');

		expect(serialize(deps.doc)).toBe('body\n\n# Heading\n');
		expectParseConverged(deps.doc);
	});

	// A replacement can also push text above the opener, which leaves line 0 foreign while the
	// opener still owns the closer below it. Dropping that run would unclose a live block.
	it('leaves a closer an opener above it still claims', async () => {
		const { deps, sr } = makeSearchReplace('```js\nbody\n```\n\n# Heading\n');

		await sr.replaceAll(scan(deps.doc, `${BACKTICKS}js`), `x\n${BACKTICKS}js`);

		expect(serialize(deps.doc)).toBe('x\n```js\nbody\n```\n\n# Heading\n');
		expect(deps.doc.children.map((c) => c.kind)).toEqual(['paragraph', 'fencedCode', 'heading']);
		expectParseConverged(deps.doc);
	});
});
