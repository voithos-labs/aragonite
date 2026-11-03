import { describe, it, expect, afterEach } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { installPlugins } from '#lib';
import { resetPluginPlatformForTests } from '#lib/testing.js';
import { admonitionsPlugin } from '#packages/admonitions/src/index.js';
import { detailsPlugin } from '#packages/details/src/index.js';
import { tocPlugin } from '#packages/toc/src/index.js';
import { footnotesPlugin } from '#packages/footnotes/src/index.js';
import { emojiPlugin } from '#packages/emoji/src/index.js';
import { highlightOccurrencesPlugin } from '#packages/highlight-occurrences/src/index.js';
import { latexPlugin } from '#packages/latex/src/index.js';
import { mermaidPlugin } from '#packages/mermaid/src/index.js';
import { parrotPlugin } from '#packages/parrot/src/index.js';
import type { EditorPlugin } from '#lib/plugin.js';
import { calloutPlugin } from '../../../routes/test/plugins/callout/register';
import { memoPlugin } from '../../../routes/test/plugins/memo/register';
import { docStatsPlugin } from '../../../routes/test/plugins/doc-stats/doc-stats-plugin';
import SHOWCASE_DOCUMENT from '../../../../examples/showcase/showcase-content.md?raw';
import { CHANGELOG_FAMILIES } from '../../../routes/changelog/changelog-content';
import { allowDevWarns } from '#lib/test/support/warn-gate.js';

// Each route re-installs the same plugin set into a process-wide registry; the second install
// onward is ignored, which is the point of this ordering check.
afterEach(() => allowDevWarns(['plugin-install']));

/**
 * A plugin's setup runs once per process, so a route that installs second inherits the first
 * route's grammar, and its SSR markup can describe different kinds than the hydrating client.
 */

// The parser never renders, so stub renderers stand in for the routes' real ones; only which
// plugins install, and in what order, can change a parse.
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
	stubMermaid(),
	parrotPlugin()
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

	// The harness memo takes every `%%` line, `%%parrot` included, so the openers sort right only
	// while the parrot registers below the memo; a tie would hand `%%parrot` to the memo.
	const BOTH_MARKERS = '%%parrot party responsibly\n\n%% memo text\n';
	it.each([
		['demo first', [demoRouteSet(), harnessSet()]],
		['harness first', [harnessSet(), demoRouteSet()]]
	])('the co-installed memo and parrot each claim their own marker (%s)', (_, order) => {
		expect(kindsUnder(order as EditorPlugin[][], BOTH_MARKERS)).toEqual(['parrot', 'memo']);
	});
});
