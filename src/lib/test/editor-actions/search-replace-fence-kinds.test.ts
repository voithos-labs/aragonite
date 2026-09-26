// A plugin kind that holds its own fence keeps one opener and one closer through a replace, as a
// code block does: a body line turned into the closer grows the fence, and an opener replaced
// away takes its stranded closer with it, so the block below stays its own (#566).
// Miss-analysis: every fence replace test drove the built-in code block; the plugin kinds each
// kept a private copy of a quarter of its rule, and no test wrote either missing shape at them.
import { describe, it, expect, beforeEach } from 'vitest';
import { parse, serialize } from '$lib';
import { resetPluginPlatformForTests } from '$lib/testing';
import { registerMathBlock } from '$lib/plugins/latex/latex-kind';
import type { Document } from '$lib/core/nodes';
import { expectParseConverged } from '$lib/test/harness/parse-converged';
import { makeSearchReplace, scanCompiled } from '$lib/test/harness/search-replace';

const scan = (doc: Document, query: string) => scanCompiled(doc, query, { caseSensitive: true });

/** The kinds a reload reads the replaced document as. */
const reloadKinds = (doc: Document) => parse(serialize(doc)).children.map((c) => c.kind);

beforeEach(() => {
	resetPluginPlatformForTests();
	registerMathBlock();
});

describe('search/replace into a math fence', () => {
	it.each([
		['backtick', '```'],
		['tilde', '~~~']
	])('grows a %s fence past a body line replaced into its closer', async (_marker, run) => {
		const { deps, sr } = makeSearchReplace(`${run}math\nXX\ny\n${run}\n\npara B\n`);

		await sr.replaceAll(scan(deps.doc, 'XX'), run);

		const grown = run + run[0];
		expect(serialize(deps.doc)).toBe(`${grown}math\n${run}\ny\n${grown}\n\npara B\n`);
		expect(reloadKinds(deps.doc)).toEqual(['mathFence', 'paragraph']);
		expectParseConverged(deps.doc);
	});

	it('drops the closer a replace over the opener line stranded', async () => {
		const { deps, sr } = makeSearchReplace('```math\nx\n```\n\npara B\n');

		await sr.replaceAll(scan(deps.doc, '```math\n'), '');

		expect(serialize(deps.doc)).toBe('x\n\npara B\n');
		expect(reloadKinds(deps.doc)).toEqual(['paragraph', 'paragraph']);
		expectParseConverged(deps.doc);
	});
});
