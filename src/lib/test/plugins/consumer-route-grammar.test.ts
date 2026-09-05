/**
 * The consumer example's seed, parsed under the plugin set that route installs. A fixture
 * naming a directive some other installed plugin claims still renders, as that plugin's
 * block, so the drift is silent everywhere but the browser.
 * Miss-analysis: only `consumer-smoke` covered the consumer route, and CI runs it on
 * pull_request / push:main, never on the dev branch the renaming commit landed on.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { parse } from '$lib/core/parser';
import { installPlugins } from '$lib';
import { resetPluginPlatformForTests } from '$lib/testing';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { detailsPlugin } from '$lib/plugins/details';
import { emojiPlugin } from '$lib/plugins/emoji';
import { footnotesPlugin } from '$lib/plugins/footnotes';
import { highlightOccurrencesPlugin } from '$lib/plugins/highlight-occurrences';
import { latexPlugin } from '$lib/plugins/latex';
import { mermaidPlugin } from '$lib/plugins/mermaid';
import { tocPlugin } from '$lib/plugins/toc';
import { calloutPlugin } from '../../../routes/test/plugins/callout/register';
import { PLUGINS_SEED } from '../../../../examples/consumer/src/routes/plugins/seed';

// The parser never renders, so a stub stands in for the route's real KaTeX engine; mermaid
// gets none there either, which is the no-engine fallback the consumer suite asserts.
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

beforeAll(() => {
	resetPluginPlatformForTests();
	installPlugins(consumerRouteSet());
});

afterAll(() => resetPluginPlatformForTests());

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
