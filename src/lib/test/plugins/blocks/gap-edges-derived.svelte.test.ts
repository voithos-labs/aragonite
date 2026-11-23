// @vitest-environment jsdom
// Which edges of a maker's block type take a gap caret, read through the eligibility check: both
// sides of a block whose text spans lines or shows only once the caret comes in, above a box, and
// none beside a one-line text Enter splits.
// Miss-analysis: the derived edges were pinned on one twin per maker, so no row read a drawn line
// type whose picture leaves the caret nowhere above it.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { definePlugin, fencedBlock, lineBlock, type TextDrawContext } from '#lib/plugin.js';
import type { FencedBlockSpec, LineBlockSpec } from '#lib/schema/block-shapes.js';
import type { BlockType } from '#lib/schema/plugin-unit.js';
import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';
import { gapEligibleAt } from '#lib/selection/gap-caret.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(() => installLayoutStubs());
afterEach(destroyMountedEditors);

const placed = (_block: unknown, ctx: TextDrawContext) => {
	const dom = document.createElement('div');
	dom.append(ctx.source);
	return { dom };
};
const picture = () => ({ dom: document.createElement('div') });

const line = (spec: Partial<LineBlockSpec<never>>) =>
	lineBlock({
		name: 'demo',
		label: 'Demo',
		match: /^\[(?<text>.*)\]$/,
		sample: '[x]',
		insert: { none: 'a test block type' },
		...spec
	} as LineBlockSpec<never>);
const fenced = (spec: Partial<FencedBlockSpec>) =>
	fencedBlock({
		name: 'demo',
		label: 'Demo',
		fence: { open: /^%%%$/, close: '%%%' },
		sample: '%%%\nx\n%%%',
		insert: { none: 'a test block type' },
		...spec
	} as FencedBlockSpec);

const LINE = '[a]\n';
const FENCE = '%%%\na\n%%%\n';

type Edges = { above: boolean; between: boolean };
const ROWS: { name: string; type: BlockType<never>; block: string; edges: Edges }[] = [
	{ name: 'a line of text', type: line({}), block: LINE, edges: { above: false, between: false } },
	{
		name: 'a drawn line whose text shows',
		type: line({ edit: 'text', draw: placed }),
		block: LINE,
		edges: { above: false, between: false }
	},
	{
		name: 'a drawn line that opens its text',
		type: line({ draw: placed }),
		block: LINE,
		edges: { above: true, between: true }
	},
	{
		name: 'a line with no draw that opens its text',
		type: line({ edit: 'source' }),
		block: LINE,
		edges: { above: true, between: true }
	},
	{
		name: 'a line focused whole',
		type: line({ edit: 'box', draw: picture }),
		block: LINE,
		edges: { above: true, between: false }
	},
	{ name: 'a fence', type: fenced({}), block: FENCE, edges: { above: true, between: true } },
	{
		name: 'a drawn fence that opens its text',
		type: fenced({ draw: placed }),
		block: FENCE,
		edges: { above: true, between: true }
	}
];

describe('a maker’s gap caret edges', () => {
	it.each(ROWS)('$name', async ({ type, block, edges }) => {
		const plugin = definePlugin({
			name: 'edges',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({ blocks: [type] })
		});
		const m = mountEditor<EditorTestSurface>({ source: `${block}\n${block}`, plugins: [plugin] });
		await m.settle();
		const doc = m.instance.__test.getDocument();
		expect(doc.children.map((child) => child.kind)).toEqual(['edges/demo', 'edges/demo']);
		expect({ above: gapEligibleAt(doc, [], 0), between: gapEligibleAt(doc, [], 1) }).toEqual(edges);
	});
});
