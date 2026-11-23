// @vitest-environment jsdom
// A twin built with `lineBlock` or `fencedBlock` reads its hand-registered kind's cut, copy and
// paste facts and the same gap and drag answers, so L8's move onto the makers keeps them.
// Miss-analysis: the twins compared cut, copy and paste facts only, so no row read gap edges or role.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AnyBlockKind } from '#lib/core/nodes.js';
import { definePlugin, installPlugins } from '#lib/schema/plugin-install.js';
import { blockFacts } from '#lib/schema/block-facts.js';
import { tryGetBlockKindDescriptor } from '#lib/schema/block-kind-descriptor.js';
import { lineBlock } from '#lib/components/block-makers/line-block.js';
import { fencedBlock } from '#lib/components/block-makers/fenced-block.js';
import type { BlockType } from '#lib/schema/plugin-unit.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { registeredMath } from '#lib/test/harness/registered-math.js';
import { mermaidPlugin } from '#packages/mermaid/src/index.js';
import { tocPlugin } from '#packages/toc/src/index.js';

beforeAll(() => installLayoutStubs());
// Each test starts with the registries reset, so the hand-registered kinds go in again.
beforeEach(() => installPlugins([registeredMath(), mermaidPlugin(), tocPlugin()]));
afterEach(destroyMountedEditors);

const picture = () => ({ dom: document.createElement('div') });
const source = (_block: unknown, ctx: { source: HTMLElement }) => {
	const dom = document.createElement('div');
	dom.append(ctx.source);
	return { dom };
};

const TWINS: { kind: string; twin: BlockType<unknown>; differs?: Partial<Facts> }[] = [
	{
		kind: 'fencedCode',
		twin: fencedBlock({
			name: 'code',
			label: 'Code',
			fence: { info: 'twin' },
			sample: '```twin\nx\n```',
			insert: { none: 'a test block type' }
		})
	},
	{
		kind: 'mathBlock',
		twin: fencedBlock({
			name: 'math',
			label: 'Math block',
			fence: [{ info: 'math' }, { open: /^\$\$$/, close: '$$' }],
			sample: '$$\nx\n$$',
			insert: { none: 'a test block type' },
			draw: source
		})
	},
	{
		kind: 'mermaid',
		twin: fencedBlock({
			name: 'mermaid',
			label: 'Diagram',
			fence: { info: 'mermaid' },
			sample: '```mermaid\ngraph TD\n```',
			insert: { none: 'a test block type' },
			edit: 'box',
			draw: picture
		})
	},
	{
		kind: 'toc',
		twin: lineBlock({
			name: 'toc',
			label: 'Table of contents',
			match: /^\[\[toc\]\]$/,
			sample: '[[toc]]',
			insert: { none: 'a test block type' },
			draw: source
		}),
		// The hand toc binds no keys, so its open text can't split; the twin's Enter splits at
		// either end, which covers both edges.
		differs: { gapEdges: 'none' }
	}
];

type Facts = ReturnType<typeof factsOf>;

/** What the editor's systems read of a kind: its cut, copy and paste facts, gap edges and role. */
function factsOf(kind: string) {
	const d = tryGetBlockKindDescriptor(kind as AnyBlockKind)!;
	return {
		...blockFacts(kind),
		pageRole: d.pageRole ?? 'object',
		gapEdges: d.gapEdges,
		mergeRole: d.mergeRole
	};
}

describe('a twin made by a block maker', () => {
	it.each(TWINS)('reads $kind’s facts', async ({ kind, twin, differs }) => {
		const twins = definePlugin({
			name: 'twins',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({ blocks: [twin] })
		});
		const m = mountEditor({ source: 'x\n', plugins: [twins] });
		await m.settle();
		expect(factsOf(twin.name)).toEqual({ ...factsOf(kind), ...differs });
	});
});
