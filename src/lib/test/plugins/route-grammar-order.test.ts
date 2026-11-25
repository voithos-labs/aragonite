// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { installPlugins } from '#lib';
import { resetPluginPlatformForTests } from '#lib/testing.js';
import { grammar, type EditorPlugin } from '#lib/plugin.js';
import { parrot, parrotPlugin } from '#packages/parrot/src/index.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { calloutPlugin } from '../../../routes/test/plugins/callout/register';
import { memoPlugin } from '../../../routes/test/plugins/memo/register';
import { docStatsPlugin } from '../../../routes/test/plugins/doc-stats/doc-stats-plugin';
import { DEMO_PLUGINS, DEMO_TAGS } from '../../../routes/demo-plugins';
import SHOWCASE_DOCUMENT from '../../../../examples/showcase/showcase-content.md?raw';
import { CHANGELOG_FAMILIES } from '../../../routes/changelog/changelog-content';

/**
 * A `setup` plugin installs once per process, so a server that rendered `/test/plugins` first must
 * not change how a demo route, which lists plugin values alone, reads its document for SSR.
 */

// The `setup` plugins in `/test/plugins`' own list.
const harnessSet = (): EditorPlugin[] => [calloutPlugin(), memoPlugin(), docStatsPlugin];

/** `/test/plugins`' default seed. */
const CALLOUT_SEED = ':::callout Title\nFirst\n:::\n';

/** `/`'s list, with the harness's plugins installed first or not. */
function showcaseKinds(source: string, harnessFirst: boolean): string[] {
	resetPluginPlatformForTests();
	if (harnessFirst) installPlugins(harnessSet());
	return grammar([...DEMO_PLUGINS, DEMO_TAGS])
		.parse(source)
		.blocks.map((block) => block.type.name);
}

describe('a demo route reads its own document the same whatever the harness installed first', () => {
	// Vacuity guard: the cases below compare two reads, and two empty ones agree just as well.
	it('installs the harness seed as a plugin container, not fallback prose', () => {
		resetPluginPlatformForTests();
		installPlugins(harnessSet());
		expect(parse(CALLOUT_SEED).children.map((block) => block.kind)).toEqual(['callout']);
		expect(showcaseKinds(SHOWCASE_DOCUMENT, false)).toContain('details/details');
	});

	it('the showcase document keeps its kinds when the harness installed first', () => {
		expect(showcaseKinds(SHOWCASE_DOCUMENT, true)).toEqual(showcaseKinds(SHOWCASE_DOCUMENT, false));
	});

	it('the changelog document keeps its kinds when the harness installed first', () => {
		// The family the route seeds itself with; the picker's other families share its grammar.
		const changelog = CHANGELOG_FAMILIES[0].document;
		expect(showcaseKinds(changelog, true)).toEqual(showcaseKinds(changelog, false));
	});
});

// The harness memo takes `%%` lines and sorts ahead of every plugin's block type, so it has to
// leave `%%parrot` to the parrot where one editor runs both (the harness's parrot seed).
describe('an editor running the harness memo and the parrot', () => {
	beforeAll(() => installLayoutStubs());
	afterEach(destroyMountedEditors);

	it('gives each its own marker', async () => {
		resetPluginPlatformForTests();
		const m = mountEditor({
			source: '%%parrot party responsibly\n\n%% memo text\n',
			plugins: [memoPlugin(), parrotPlugin()]
		});
		await m.settle();
		expect([m.instance.getBlockKindAt([0]), m.instance.getBlockKindAt([1])]).toEqual([
			parrot.name,
			'memo'
		]);
	});
});
