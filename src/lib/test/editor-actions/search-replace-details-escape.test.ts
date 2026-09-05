import { describe, it, expect, beforeEach } from 'vitest';
import { serialize } from '$lib/core/serializer';
import type { Document } from '$lib/core/nodes';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { __resetPasteSurfacesForTests } from '$lib/tree-operations/paste-surfaces';
import { registerDetailsKind } from '$lib/plugins/details/details-kind';
import { expectParseConverged } from '$lib/test/harness/parse-converged';
import { makeSearchReplace, scanCompiled } from '$lib/test/harness/search-replace';

// Miss-analysis: the search-replace escape suites pinned the fence and cell arms of the
// clone path, but none targeted a bodyWrite container — a template landing a terminator in
// a details body truncated the container on its own reparse (GH #40).

beforeEach(() => {
	__resetSchemaRegistriesForTests();
	__resetPasteSurfacesForTests();
	registerDetailsKind();
});

const scan = (doc: Document, query: string) => scanCompiled(doc, query, { caseSensitive: true });

describe('search/replace into a details body', () => {
	it('escapes a template that lands the close tag, keeping the container intact', async () => {
		const { deps, sr } = makeSearchReplace(
			'<details>\n<summary>T</summary>\n\nbody\n\n</details>\n'
		);

		await sr.replaceAll(scan(deps.doc, 'body'), '</details>');

		expect(serialize(deps.doc)).toBe(
			'<details>\n<summary>T</summary>\n\n&lt;/details>\n\n</details>\n'
		);
		expect(deps.doc.children.map((c) => c.kind)).toEqual(['details']);
		expectParseConverged(deps.doc);
	});

	// The summary's bytes are emitted into the opener line, where a stray tag corrupts the
	// container's own chrome; the escape answers there too.
	it('escapes a template landing the close tag in the summary chrome', async () => {
		const { deps, sr } = makeSearchReplace(
			'<details>\n<summary>title</summary>\n\nbody\n\n</details>\n'
		);

		await sr.replaceAll(scan(deps.doc, 'title'), '</details>');

		expect(serialize(deps.doc)).toContain('<summary>&lt;/details></summary>');
		expect(deps.doc.children.map((c) => c.kind)).toEqual(['details']);
		expectParseConverged(deps.doc);
	});

	it('leaves the same template verbatim at the document root', async () => {
		const { deps, sr } = makeSearchReplace('body\n');

		await sr.replaceAll(scan(deps.doc, 'body'), '</details>');

		expect(serialize(deps.doc)).toBe('</details>\n');
		expectParseConverged(deps.doc);
	});
});
