// @vitest-environment jsdom
// A block type's `height(block, metrics)` is asked with the width the editor's windowing estimates
// at, and with its type metrics, whichever maker made the type; its answer follows that width.
// Miss-analysis: `height` got the block alone, and no row asked what a maker's height is handed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	container,
	definePlugin,
	fencedBlock,
	lineBlock,
	type Block,
	type HeightMetrics
} from '#lib/plugin.js';
import type { HeightOracle } from '#lib/windowing/height-estimator.js';
import type { Document } from '#lib/core/nodes.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';

interface Seam {
	getHeightOracle(): HeightOracle;
	getDocument(): Document;
}

// jsdom lays nothing out, so the editor's width is whatever a box reports here.
let width = 640;

beforeEach(() => {
	installLayoutStubs();
	vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(() => width);
});
afterEach(async () => {
	await destroyMountedEditors();
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

type Height = (block: Block<never>, metrics: HeightMetrics) => number;

const common = { name: 'tall', label: 'Tall', insert: { none: 'a test block type' } };
const MAKERS: [string, string, (height: Height) => unknown][] = [
	[
		'lineBlock',
		'@@ x\n',
		(height) => lineBlock({ ...common, match: /^@@ (?<text>.*)$/, sample: '@@ x', height })
	],
	[
		'fencedBlock',
		'```tall\nx\n```\n',
		(height) =>
			fencedBlock({ ...common, fence: { info: 'tall' }, sample: '```tall\nx\n```', height })
	],
	[
		'container',
		'%> x\n',
		(height) =>
			container({
				...common,
				sample: '%> x',
				lines: { shape: 'marked', first: '%> ', rest: '%> ', reads: /^%> ?/, lazy: true },
				height
			})
	]
];

describe("a block type's height", () => {
	it.each(MAKERS)(
		'of a %s is asked with the editor’s width and metrics',
		async (_, source, make) => {
			const asked: { width: number; lineHeight: number }[] = [];
			const type = make((_block, metrics) => {
				asked.push({ width: metrics.width, lineHeight: metrics.lineHeight });
				return metrics.width / 4;
			});
			const plugin = definePlugin({
				name: 'tall',
				version: '1.0.0',
				editor: '*',
				contributes: () => ({ blocks: [type as never] })
			});
			const mountAt = async (at: number) => {
				width = at;
				asked.length = 0;
				const m = mountEditor<Seam>({ source: `intro\n\n${source}`, plugins: [plugin] });
				await m.settle();
				return m;
			};

			const wide = await mountAt(640);
			expect(asked.at(-1)?.width).toBe(640);
			expect(asked.at(-1)?.lineHeight).toBeGreaterThan(0);
			const oracle = wide.instance.__test.getHeightOracle();
			const tall = wide.instance.__test.getDocument().children[1];
			expect(oracle.estimate(tall, 640) - oracle.estimate(tall, 480)).toBe(40);

			await mountAt(480);
			expect(asked.at(-1)?.width).toBe(480);
		}
	);
});
