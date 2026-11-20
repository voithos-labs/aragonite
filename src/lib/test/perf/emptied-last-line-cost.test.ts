// The step that ends an emptied last paragraph asks the fix-up's host nothing until a paragraph
// stands emptied under another block, so a letter typed in a one-line bullet pays it nothing.
// Miss-analysis: the keystroke cost rows count parses and sibling reads, never what the fix-up
// asks its host, so a trait ask on every key in a one-paragraph item or quote passed them all.
import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import type { CstNode } from '#lib/core/nodes.js';
import { defaultGrammarView } from '#lib/schema/editor-grammar.js';
import { editorHost } from '#lib/tree-operations/fix-up/editor-host.js';
import { endEmptiedLastLine } from '#lib/tree-operations/fix-up/runs.js';
import type { Host } from '#lib/tree-operations/fix-up/types.js';
import { startWork } from '#lib/tree-operations/fix-up/work.js';

const quote = () => parse('> zz\n>\n> ab').children[0];
const bullet = () => parse('- ab').children[0].children![0];

/** The step over `owner`'s body with its last block's bytes set to `last`: how often it asked the
 *  host for a kind's traits, and the bytes it left that block. */
function stepOver(owner: CstNode, last: string): { asks: number; raw: string } {
	const children = owner.children!.map((child, i, all) =>
		i === all.length - 1 ? { ...child, raw: last } : child
	);
	const real = editorHost(defaultGrammarView);
	let asks = 0;
	const host: Host = { ...real, kindTraits: (kind) => (asks++, real.kindTraits(kind)) };
	const work = startWork({ owner, children, lineEnding: '\n' }, {});
	endEmptiedLastLine(work, host);
	return { asks, raw: work.blocks.at(children.length - 1).raw };
}

describe('ending an emptied last line asks the host only once a paragraph stands emptied', () => {
	it.each([
		['a quote’s last paragraph that holds text', quote, 'abx'],
		['a one-line bullet that holds text', bullet, 'abx'],
		['a one-line bullet emptied, which stays on its marker’s line', bullet, '']
	])('%s asks nothing and keeps its bytes', (_, owner, last) => {
		expect(stepOver(owner(), last)).toEqual({ asks: 0, raw: last });
	});

	it('a quote’s last paragraph emptied still gets its line', () => {
		expect(stepOver(quote(), '').raw).toBe('\n');
	});
});
