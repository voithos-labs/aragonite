// @vitest-environment node
// `dragLabel` is what the drag ghost calls a block type, from every maker: the editor holds it on
// the type it names, and a blank one is refused as the type is made.
// Miss-analysis: no row read a maker's type off the descriptor the drag ghost reads.
import { describe, expect, it } from 'vitest';
import { container, definePlugin, fencedBlock, grammar, lineBlock } from '#lib/plugin.js';
import { tryGetBlockKindDescriptor } from '#lib/schema/block-kind-descriptor.js';

const common = { label: 'Demo', insert: { none: 'a test block type' } } as const;
const MARKED = { shape: 'marked', first: '%> ', rest: '%> ', reads: /^%> ?/, lazy: true } as const;

const makers = {
	lineBlock: (dragLabel: string) =>
		lineBlock({ ...common, name: 'line', match: /^%%(?<text>.*)$/, sample: '%%x', dragLabel }),
	fencedBlock: (dragLabel: string) =>
		fencedBlock({
			...common,
			name: 'fenced',
			fence: { info: 'demo' },
			sample: '```demo\nx\n```',
			dragLabel
		}),
	container: (dragLabel: string) =>
		container({ ...common, name: 'box', lines: MARKED, sample: '%> x', dragLabel })
};

describe('BlockCommon.dragLabel', () => {
	for (const [maker, make] of Object.entries(makers)) {
		it(`is held on the type ${maker} makes`, () => {
			const type = make('Formula');
			const plugin = definePlugin({
				name: `ghost-${maker.toLowerCase()}`,
				version: '1.0.0',
				editor: '*',
				contributes: () => ({ blocks: [type] })
			});
			// The grammar holds its plugins' types while it's reachable.
			const held = grammar([plugin]);
			expect(tryGetBlockKindDescriptor(type.name as never)?.dragLabel).toBe('Formula');
			void held;
		});

		it(`is refused blank by ${maker}`, () => {
			expect(() => make('  ')).toThrow(/blank dragLabel/);
		});
	}
});
