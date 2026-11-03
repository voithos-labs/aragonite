/**
 * The consumer example's seed, parsed under the plugin set that route installs. A directive
 * another installed plugin owns still renders, as that plugin's block, so the drift shows
 * only in the browser.
 * Miss-analysis: only `consumer-smoke` covered the consumer route, and CI never runs it on dev.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { installPlugins } from '#lib';
import { admonitionsPlugin } from '#packages/admonitions/src/index.js';
import { detailsPlugin } from '#packages/details/src/index.js';
import { emojiPlugin } from '#packages/emoji/src/index.js';
import { footnotesPlugin } from '#packages/footnotes/src/index.js';
import { highlightOccurrencesPlugin } from '#packages/highlight-occurrences/src/index.js';
import { latexPlugin } from '#packages/latex/src/index.js';
import { mermaidPlugin } from '#packages/mermaid/src/index.js';
import { tocPlugin } from '#packages/toc/src/index.js';
import { calloutPlugin } from '../../../routes/test/plugins/callout/register';
import { PLUGINS_SEED } from '../../../../examples/consumer/src/routes/plugins/seed';

// The parser never renders, so a stub stands in for the route's real KaTeX; mermaid gets no
// renderer there either, which is the fallback the consumer suite asserts.
const consumerRouteSet = () => [
	calloutPlugin(),
	detailsPlugin(),
	admonitionsPlugin(),
	latexPlugin({ renderer: () => ({ dom: document.createElement('span') }) }),
	mermaidPlugin(),
	tocPlugin(),
	highlightOccurrencesPlugin(),
	emojiPlugin(),
	footnotesPlugin()
];

beforeEach(() => {
	installPlugins(consumerRouteSet());
});

describe('the consumer example route parses its seed as the kinds its suite asserts', () => {
	it('resolves every seeded construct to the plugin that claims it', () => {
		expect(parse(PLUGINS_SEED).children.map((block) => block.kind)).toEqual([
			'heading',
			'toc',
			'callout',
			'details',
			'paragraph',
			'mathBlock',
			'admonition',
			'mermaid',
			'directiveContainer',
			'paragraph',
			'paragraph',
			'footnote-def'
		]);
	});
});
