// @vitest-environment jsdom
// The `/changelog` route serves the repo's own changelog, one release family per document, so
// every entry ships to a demo route as untested content and a byte-exact round trip is the
// route's whole promise. The documents are imported here rather than re-composed, so neither
// the prelude nor a newly added family can drift out from under this guard.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { installPlugins } from '#lib';
import { admonitionsPlugin } from '#packages/admonitions/src/index.js';
import { detailsPlugin, DETAILS } from '#packages/details/src/index.js';
import { toc } from '#packages/toc/src/index.js';
import { footnotesPlugin } from '#packages/footnotes/src/index.js';
import { latexPlugin } from '#packages/latex/src/index.js';
import { mermaidPlugin } from '#packages/mermaid/src/index.js';
import { CHANGELOG_FAMILIES } from '../../../routes/changelog/changelog-content';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';

const DETAILS_PLUGIN = detailsPlugin();

beforeEach(() => {
	installPlugins([
		admonitionsPlugin(),
		DETAILS_PLUGIN,
		footnotesPlugin(),
		latexPlugin(),
		mermaidPlugin()
	]);
});
afterEach(destroyMountedEditors);

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

	it('resolves the prelude to a collapsed details holding the outline', async () => {
		const [outline] = parse(CHANGELOG_FAMILIES[0].document).children;
		expect(outline.kind).toBe(DETAILS);
		expect(outline.raw.startsWith('<details>\n')).toBe(true);
		// Child 0 is the summary; in an editor running the outline, the `[[toc]]` reads as its block
		// inside the container rather than falling back to prose.
		installLayoutStubs();
		const m = mountEditor({ source: PRELUDE, plugins: [DETAILS_PLUGIN, toc({ maxDepth: 3 })] });
		await m.settle();
		expect(m.instance.getBlockKindAt([0, 1])).toBe('toc/toc');
	});
});
