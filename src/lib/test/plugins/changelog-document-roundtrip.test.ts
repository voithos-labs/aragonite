import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { installPlugins } from '#lib';
import { admonitionsPlugin } from '#lib/plugins/admonitions/index.js';
import { detailsPlugin, DETAILS } from '#lib/plugins/details/index.js';
import { tocPlugin, TOC_BLOCK } from '#lib/plugins/toc/index.js';
import { footnotesPlugin } from '#lib/plugins/footnotes/index.js';
import { emojiPlugin } from '#lib/plugins/emoji/index.js';
import { highlightOccurrencesPlugin } from '#lib/plugins/highlight-occurrences/index.js';
import { latexPlugin } from '#lib/plugins/latex/index.js';
import { mermaidPlugin } from '#lib/plugins/mermaid/index.js';
import { parrotPlugin } from '#lib/plugins/parrot/index.js';
import { CHANGELOG_FAMILIES } from '../../../routes/changelog/changelog-content';

/**
 * The `/changelog` route serves the repo's own changelog, one release family per document, so
 * every entry ships to a demo route as untested content and a byte-exact round trip is the
 * route's whole promise. The documents are imported here rather than re-composed, so neither
 * the prelude nor a newly added family can drift out from under this guard.
 */

beforeEach(() => {
	installPlugins([
		admonitionsPlugin(),
		detailsPlugin(),
		tocPlugin({ maxDepth: 3 }),
		footnotesPlugin(),
		emojiPlugin(),
		highlightOccurrencesPlugin(),
		latexPlugin(),
		mermaidPlugin(),
		parrotPlugin()
	]);
});

const PRELUDE = '<details>\n<summary>Versions</summary>\n\n[[toc]]\n\n</details>\n\n';

describe('changelog documents', () => {
	// A `?raw` glob resolving to nothing would round-trip vacuously, and so would a prelude the
	// route stopped prepending. The file's `../changelog.md` pointer is a 404 on the site.
	it('composes every release family behind the route prelude, minus the index pointer', () => {
		expect(CHANGELOG_FAMILIES.length).toBeGreaterThan(1);
		for (const { id, document } of CHANGELOG_FAMILIES) {
			expect(document.startsWith(`${PRELUDE}# Changelog ${id}\n`)).toBe(true);
			expect(document, id).not.toContain('](../changelog.md)');
		}
		const bytes = CHANGELOG_FAMILIES.reduce((sum, f) => sum + f.document.length, 0);
		expect(bytes).toBeGreaterThan(20_000);
	});

	// The picker orders the families, and the route seeds itself from the first.
	it('orders the families newest first', () => {
		const order = CHANGELOG_FAMILIES.map((f) => f.id);
		expect(order).toEqual([...order].sort((a, b) => b.localeCompare(a, 'en', { numeric: true })));
	});

	it('round-trips every family byte-for-byte under the changelog plugin set', () => {
		for (const { id, document } of CHANGELOG_FAMILIES) {
			expect(serialize(parse(document)), id).toBe(document);
		}
	});

	it('resolves the prelude to a collapsed details holding the outline', () => {
		const [outline] = parse(CHANGELOG_FAMILIES[0].document).children;
		expect(outline.kind).toBe(DETAILS);
		// Child 0 is the summary; the `[[toc]]` must have parsed as the plugin block inside
		// the container rather than falling back to prose.
		expect(outline.children?.[1]?.kind).toBe(TOC_BLOCK);
		expect(outline.raw.startsWith('<details>\n')).toBe(true);
	});
});
