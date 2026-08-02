import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { installPlugins } from '$lib';
import { resetPluginPlatformForTests } from '$lib/testing';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { detailsPlugin, DETAILS } from '$lib/plugins/details';
import { tocPlugin, TOC_BLOCK } from '$lib/plugins/toc';
import { footnotesPlugin } from '$lib/plugins/footnotes';
import { emojiPlugin } from '$lib/plugins/emoji';
import { highlightOccurrencesPlugin } from '$lib/plugins/highlight-occurrences';
import { latexPlugin } from '$lib/plugins/latex';
import { mermaidPlugin } from '$lib/plugins/mermaid';
import { CHANGELOG_DOCUMENT } from '../../../routes/changelog/changelog-content';

/**
 * The `/changelog` route serves the repo's own changelog, so every release entry ships to a
 * demo route as untested content and byte-exact round-trip is the route's whole claim. A unit
 * case by necessity: the route exposes no `window.__test` bridge, and the composed document is
 * imported here rather than re-composed, so the prelude cannot drift out from under the guard.
 */

beforeAll(() => {
	resetPluginPlatformForTests();
	// The parser never renders, so no-op renderers satisfy the required options.
	installPlugins([
		admonitionsPlugin(),
		detailsPlugin(),
		tocPlugin({ maxDepth: 3 }),
		footnotesPlugin(),
		emojiPlugin(),
		highlightOccurrencesPlugin(),
		latexPlugin({ renderer: () => ({ dom: document.createElement('span') }) }),
		mermaidPlugin({ renderer: async () => '<svg />' })
	]);
});

afterAll(() => resetPluginPlatformForTests());

describe('changelog document', () => {
	// A `?raw` import resolving to nothing would round-trip vacuously, and so would a
	// prelude the route stopped prepending.
	it('composes the real changelog behind the route prelude', () => {
		expect(CHANGELOG_DOCUMENT).toMatch(
			/^<details>\n<summary>Versions<\/summary>\n\n\[\[toc\]\]\n\n<\/details>\n\n# Changelog\n/
		);
		expect(CHANGELOG_DOCUMENT.length).toBeGreaterThan(20_000);
	});

	it('round-trips byte-for-byte under the changelog plugin set', () => {
		expect(serialize(parse(CHANGELOG_DOCUMENT))).toBe(CHANGELOG_DOCUMENT);
	});

	it('resolves the prelude to a collapsed details holding the outline', () => {
		const [outline] = parse(CHANGELOG_DOCUMENT).children;
		expect(outline.kind).toBe(DETAILS);
		// Child 0 is the summary chrome; the `[[toc]]` must have parsed as the plugin leaf
		// inside the container rather than falling back to prose.
		expect(outline.children?.[1]?.kind).toBe(TOC_BLOCK);
		expect(outline.raw.startsWith('<details>\n')).toBe(true);
	});
});
