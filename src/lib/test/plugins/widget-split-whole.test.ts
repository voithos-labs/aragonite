// @vitest-environment jsdom
// A live Enter inside a widget's shown source (a formula, a footnote reference) cuts at the widget's
// nearer edge, as a cut inside any widget does. Source mode splits at the caret and never asks.
// Miss-analysis: a plugin's widget had no policy row, so no row asked where a cut inside one goes.
import { describe, expect, it } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { rebalanceLiveSplit } from '#lib/core/inline/live-edit/live-split.js';
import { installPlugins } from '#lib/schema/plugin-install.js';
import { topLevelSplit } from '#lib/test/harness/fixture-grammar.js';
import { latexPlugin } from '#packages/latex/src/index.js';
import { footnotesPlugin } from '#packages/footnotes/src/index.js';

/** The halves a live Enter at `offset` writes, or null for the literal cut. */
function liveEnter(source: string, offset: number) {
	const node = parse(source, { scope: 'fragment' }).children[0];
	const first = node.raw.slice(0, offset);
	const second = node.raw.slice(offset);
	return rebalanceLiveSplit(
		node,
		offset,
		first.endsWith('\n') ? first : first + '\n',
		second.endsWith('\n') ? second : second + '\n',
		topLevelSplit(node)
	);
}

describe('a live Enter inside a plugin widget’s shown source', () => {
	it.each([
		['a formula', '$x^q2$ tail\n', 4, { firstRaw: '$x^q2$\n', secondRaw: ' tail\n' }],
		['a footnote reference', 'a [^nn] z\n', 5, { firstRaw: 'a [^nn]\n', secondRaw: ' z\n' }]
	])('cuts at the nearer edge of %s', (_name, source, offset, halves) => {
		installPlugins([
			latexPlugin({ renderer: () => ({ dom: document.createElement('span') }) }),
			footnotesPlugin()
		]);
		expect(liveEnter(source, offset)).toEqual(halves);
	});
});
