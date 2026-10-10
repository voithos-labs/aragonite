import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { installPlugins } from '#lib';
import { isBlockKindRegistered } from '#lib/schema/block-kind-descriptor.js';
import { admonitionsPlugin } from '#lib/plugins/admonitions/index.js';
import { detailsPlugin, DETAILS } from '#lib/plugins/details/index.js';
import { tocPlugin } from '#lib/plugins/toc/index.js';
import { footnotesPlugin, FOOTNOTE_DEF_KIND } from '#lib/plugins/footnotes/index.js';
import { emojiPlugin } from '#lib/plugins/emoji/index.js';
import { highlightOccurrencesPlugin } from '#lib/plugins/highlight-occurrences/index.js';
import { latexPlugin, MATH_BLOCK } from '#lib/plugins/latex/index.js';
import { mermaidPlugin } from '#lib/plugins/mermaid/index.js';
import { parrotPlugin } from '#lib/plugins/parrot/index.js';
import SHOWCASE_DOCUMENT from '../../../routes/showcase-content.md?raw';

/**
 * The `/` showcase is the broadest realistic document in the repo and the first thing a
 * visitor edits, so a construct in it that fails to round-trip reaches a consumer rather than
 * CI. A unit case by necessity: the route exposes no `window.__test` bridge, and no single
 * page load installs all the bundled plugins.
 */

beforeEach(() => {
	installPlugins([
		admonitionsPlugin(),
		detailsPlugin(),
		tocPlugin(),
		footnotesPlugin(),
		emojiPlugin(),
		highlightOccurrencesPlugin(),
		latexPlugin(),
		mermaidPlugin(),
		parrotPlugin()
	]);
});

describe('showcase document', () => {
	// Without this the round trip below would pass with every install having silently failed:
	// the plain grammar round-trips most of these bytes as prose.
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
