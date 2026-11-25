// @vitest-environment jsdom
// The consumer example's seed, read by an editor running the plugin list that route runs. A
// directive another listed plugin owns still renders, as that plugin's block, so the drift shows
// only in the browser.
// Miss-analysis: only `consumer-smoke` covered the consumer route, and CI never runs it on dev.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { conspiracyPlugin } from '../../../routes/test/plugins/conspiracy/conspiracy-plugin';
import { routePlugins } from '../../../../examples/consumer/src/routes/plugins/plugins';
import { PLUGINS_SEED } from '../../../../examples/consumer/src/routes/plugins/seed';

beforeAll(() => installLayoutStubs());
afterEach(destroyMountedEditors);

describe('the consumer example route parses its seed as the kinds its suite asserts', () => {
	it('resolves every seeded construct to the plugin that claims it', async () => {
		const m = mountEditor<EditorTestSurface>({
			source: PLUGINS_SEED,
			plugins: routePlugins(conspiracyPlugin),
			scrollMode: 'host'
		});
		await m.settle();
		const doc = m.instance.__test.getDocument();
		expect(doc.children.map((block) => block.kind)).toEqual([
			'heading',
			'toc/toc',
			'conspiracy/conspiracy',
			'details/details',
			'paragraph',
			'latex/block',
			'admonitions/admonition',
			'mermaid/diagram',
			'directiveContainer',
			'paragraph',
			'paragraph',
			'footnotes/definition'
		]);
	});
});
