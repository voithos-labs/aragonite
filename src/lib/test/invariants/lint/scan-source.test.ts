/**
 * The scan harness's own coverage guard. Every repo-wide lint inherits its blind spots
 * from `collectEditorSources()`, so a root silently dropping out of the default set
 * narrows a dozen guards at once. A MISSING root throws in `readdirSync`; what needs
 * asserting is the softer regression — a root still present but no longer reached, or a
 * file collected twice because a lint re-adds a root the default already covers.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, EDITOR_SRC, REPO_WIDE_ROOTS } from './scan-source';

describe('repo-wide scan roots', () => {
	const sources = collectEditorSources();
	const paths = sources.map((f) => f.relPath);

	it('reaches all three roots, none of them empty', () => {
		const byRoot = {
			library: paths.filter((p) => p.startsWith('src/lib/')),
			referencePlugins: paths.filter((p) => p.startsWith('src/routes/test/plugins/')),
			consumerExample: paths.filter((p) => p.startsWith('examples/consumer/src/'))
		};
		for (const [root, hits] of Object.entries(byRoot)) {
			expect(hits.length, `repo-wide scan reached no file under ${root}`).toBeGreaterThan(0);
		}
		expect(
			byRoot.library.length + byRoot.referencePlugins.length + byRoot.consumerExample.length
		).toBe(paths.length);
	});

	it('sees the reference plugin the external-author rules are modelled on', () => {
		expect(paths).toContain('src/routes/test/plugins/callout/callout-kind.ts');
		expect(paths).toContain('examples/consumer/src/plugins/callout/callout-kind.ts');
	});

	it('collects each file exactly once (no root nested inside another)', () => {
		expect(new Set(paths).size).toBe(paths.length);
	});

	it('an explicit root narrows the scan (the opt-out lints rely on this)', () => {
		const libraryOnly = collectEditorSources(EDITOR_SRC).map((f) => f.relPath);
		expect(libraryOnly.length).toBeLessThan(paths.length);
		expect(libraryOnly.every((p) => p.startsWith('src/lib/'))).toBe(true);
	});

	it('excludes test, e2e, and declaration files from every root', () => {
		// `src/routes/test/plugins` is itself a root, so its own `test` segment is
		// expected; what must not appear is a `test`/`e2e` directory BELOW a root.
		const belowRoot = paths.map((p) => p.replace(/^src\/routes\/test\/plugins\//, ''));
		expect(belowRoot.filter((p) => /(^|\/)(test|e2e)\//.test(p))).toEqual([]);
		expect(paths.filter((p) => p.endsWith('.d.ts'))).toEqual([]);
	});

	it('REPO_WIDE_ROOTS is the declared set the default scan walks', () => {
		expect(REPO_WIDE_ROOTS).toHaveLength(3);
		expect(REPO_WIDE_ROOTS[0]).toBe(EDITOR_SRC);
	});
});
