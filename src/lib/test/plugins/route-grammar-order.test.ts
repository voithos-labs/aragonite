import { describe, it, expect, afterAll } from 'vitest';
import { parse } from '$lib/core/parser';
import { installPlugins } from '$lib';
import { resetPluginPlatformForTests } from '$lib/testing';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { detailsPlugin } from '$lib/plugins/details';
import { tocPlugin } from '$lib/plugins/toc';
import { footnotesPlugin } from '$lib/plugins/footnotes';
import { emojiPlugin } from '$lib/plugins/emoji';
import { highlightOccurrencesPlugin } from '$lib/plugins/highlight-occurrences';
import { latexPlugin } from '$lib/plugins/latex';
import { mermaidPlugin } from '$lib/plugins/mermaid';
import type { EditorPlugin } from '$lib/plugin';
import { calloutPlugin } from '../../../routes/test/plugins/callout/register';
import { memoPlugin } from '../../../routes/test/plugins/memo/register';
import { docStatsPlugin } from '../../../routes/test/plugins/doc-stats/doc-stats-plugin';
import { SHOWCASE_DOCUMENT } from '../../../routes/showcase-content';
import { CHANGELOG_FAMILIES } from '../../../routes/changelog/changelog-content';

/**
 * A plugin's setup runs once per process, so a route that installs second inherits whatever
 * grammar the first route registered. One dev/SSR server renders every route from one process
 * while each browser load starts a fresh realm — a route whose parse depends on that history
 * ships SSR markup describing different kinds than the client that hydrates it.
 */

// The parser never renders, so stub renderers stand in for the routes' real engines; only
// which plugins install, and in what order, can move a parse.
const stubLatex = (): EditorPlugin =>
	latexPlugin({ renderer: () => ({ dom: document.createElement('span') }) });
const stubMermaid = (): EditorPlugin => mermaidPlugin({ renderer: async () => '<svg />' });

// The `plugins` props of `/` and `/changelog` (same names, same order) and of `/test/plugins`.
const demoRouteSet = (): EditorPlugin[] => [
	admonitionsPlugin(),
	detailsPlugin(),
	tocPlugin(),
	footnotesPlugin(),
	emojiPlugin(),
	highlightOccurrencesPlugin(),
	stubLatex(),
	stubMermaid()
];

const harnessSet = (): EditorPlugin[] => [
	calloutPlugin(),
	detailsPlugin(),
	stubLatex(),
	admonitionsPlugin(),
	stubMermaid(),
	memoPlugin(),
	docStatsPlugin,
	tocPlugin()
];

/** `/test/plugins`' default seed. */
const CALLOUT_SEED = ':::callout Title\nFirst\n:::\n';

function kindsUnder(installOrder: EditorPlugin[][], source: string): string[] {
	resetPluginPlatformForTests();
	for (const set of installOrder) installPlugins(set);
	return parse(source).children.map((block) => block.kind);
}

afterAll(() => resetPluginPlatformForTests());

describe('a route parses its own document the same however other routes installed first', () => {
	// Vacuity guard: every case below compares two parses, and two fallback-prose parses
	// compare equal just as happily as two correct ones.
	it('resolves the harness seed to a plugin container, not fallback prose', () => {
		expect(kindsUnder([harnessSet()], CALLOUT_SEED)).not.toEqual(['paragraph']);
	});

	it('the harness seed keeps its kind when a demo route installed first', () => {
		expect(kindsUnder([demoRouteSet(), harnessSet()], CALLOUT_SEED)).toEqual(
			kindsUnder([harnessSet()], CALLOUT_SEED)
		);
	});

	it('the showcase document keeps its kinds when the harness installed first', () => {
		expect(kindsUnder([harnessSet(), demoRouteSet()], SHOWCASE_DOCUMENT)).toEqual(
			kindsUnder([demoRouteSet()], SHOWCASE_DOCUMENT)
		);
	});

	it('the changelog document keeps its kinds when the harness installed first', () => {
		// The family the route seeds itself with; the picker's other families share its grammar.
		const changelog = CHANGELOG_FAMILIES[0].document;
		expect(kindsUnder([harnessSet(), demoRouteSet()], changelog)).toEqual(
			kindsUnder([demoRouteSet()], changelog)
		);
	});
});
