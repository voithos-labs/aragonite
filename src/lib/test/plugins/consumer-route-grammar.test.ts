// @vitest-environment jsdom
// The consumer example's seed, read by an editor running the plugin set that route lists. A
// directive another installed plugin owns still renders, as that plugin's block, so the drift
// shows only in the browser.
// Miss-analysis: only `consumer-smoke` covered the consumer route, and CI never runs it on dev.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { admonitionsPlugin } from '#packages/admonitions/src/index.js';
import { detailsPlugin } from '#packages/details/src/index.js';
import { emoji } from '#packages/emoji/src/index.js';
import { footnotesPlugin } from '#packages/footnotes/src/index.js';
import { latex } from '#packages/latex/src/index.js';
import { grammar } from '#lib/plugin.js';
import { mermaid } from '#packages/mermaid/src/index.js';
import { toc } from '#packages/toc/src/index.js';
import { calloutPlugin } from '../../../routes/test/plugins/callout/register';
import { PLUGINS_SEED } from '../../../../examples/consumer/src/routes/plugins/seed';

// The parser never renders, so a stub stands in for the route's real KaTeX; mermaid gets no
// renderer there either, which is the fallback the consumer suite asserts.
const consumerRouteSet = () => [
	calloutPlugin(),
	detailsPlugin(),
	admonitionsPlugin(),
	mermaid,
	toc,
	emoji,
	footnotesPlugin()
];

beforeAll(() => installLayoutStubs());
afterEach(destroyMountedEditors);

describe('the consumer example route parses its seed as the kinds its suite asserts', () => {
	it('resolves every seeded construct to the plugin that claims it', async () => {
		const m = mountEditor<EditorTestSurface>({
			source: PLUGINS_SEED,
			plugins: consumerRouteSet(),
			scrollMode: 'host'
		});
		await m.settle();
		const doc = m.instance.__test.getDocument();
		expect(doc.children.map((block) => block.kind)).toEqual([
			'heading',
			'toc/toc',
			'callout',
			'details',
			'paragraph',
			// A plugin value's block, which only the route's editor reads (below).
			'paragraph',
			'admonition',
			'mermaid/diagram',
			'directiveContainer',
			'paragraph',
			'paragraph',
			'footnote-def'
		]);
		const { blocks } = grammar([latex]).parse(PLUGINS_SEED);
		const math = blocks.filter((b) => b.type.name === 'latex/block').map((b) => b.text);
		expect(math).toEqual(['$$e^{i\\pi} + 1 = 0$$\n']);
	});
});
