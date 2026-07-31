import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { installPlugins } from '$lib';
import { resetPluginPlatformForTests } from '$lib/testing';
import { isBlockKindRegistered } from '$lib/schema/block-kind-descriptor';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { detailsPlugin, DETAILS } from '$lib/plugins/details';
import { tocPlugin } from '$lib/plugins/toc';
import { footnotesPlugin, FOOTNOTE_DEF_KIND } from '$lib/plugins/footnotes';
import { emojiPlugin } from '$lib/plugins/emoji';
import { highlightOccurrencesPlugin } from '$lib/plugins/highlight-occurrences';
import { latexPlugin, MATH_BLOCK } from '$lib/plugins/latex';
import { mermaidPlugin } from '$lib/plugins/mermaid';
import { SHOWCASE_DOCUMENT } from '../../../routes/showcase-content';

/**
 * The `/` showcase is the broadest realistic document in the repo and the 1.0 pitch
 * surface, so a construct in it that fails to round-trip reaches a consumer on their
 * first edit of the demo rather than CI. A unit case by necessity: the route exposes no
 * `window.__test` bridge, and no single page load installs all the bundled plugins.
 */

beforeAll(() => {
	resetPluginPlatformForTests();
	// The parser never renders, so no-op renderers satisfy the required options.
	installPlugins([
		admonitionsPlugin(),
		detailsPlugin(),
		tocPlugin(),
		footnotesPlugin(),
		emojiPlugin(),
		highlightOccurrencesPlugin(),
		latexPlugin({ renderer: () => ({ dom: document.createElement('span') }) }),
		mermaidPlugin({ renderer: async () => '<svg />' })
	]);
});

afterAll(() => resetPluginPlatformForTests());

describe('showcase document', () => {
	// Without this the round-trip below would pass with every install silently
	// failed — the bare grammar round-trips most of these bytes as prose.
	it('installed the plugin grammar the document is written against', () => {
		for (const kind of [FOOTNOTE_DEF_KIND, MATH_BLOCK, DETAILS, 'admonition', 'githubAlert']) {
			expect(isBlockKindRegistered(kind), `plugin kind not registered: ${kind}`).toBe(true);
		}
	});

	it('round-trips byte-for-byte under the showcase plugin set', () => {
		expect(serialize(parse(SHOWCASE_DOCUMENT))).toBe(SHOWCASE_DOCUMENT);
	});

	it('resolves the plugin constructs to plugin kinds, not fallback prose', () => {
		const kinds = new Set<string>(parse(SHOWCASE_DOCUMENT).children.map((block) => block.kind));
		for (const kind of [DETAILS, 'admonition', 'githubAlert', FOOTNOTE_DEF_KIND]) {
			expect(kinds.has(kind), `showcase construct fell back to prose: ${kind}`).toBe(true);
		}
	});
});
