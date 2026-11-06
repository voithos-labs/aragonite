// G1.145: the blocks a fix-up re-divided read back as themselves with the block after them.
import { describe, it, expect } from 'vitest';
import type { CstNode } from '#lib/core/nodes.js';
import { parse } from '#lib/core/parser.js';
import { defaultGrammarView } from '#lib/schema/editor-grammar.js';
import { checkSettledWindowReadsBack } from '#lib/invariants/settled-window-reads-back.js';

const body = (children: CstNode[]) => ({ children, owner: undefined, lineEnding: '\n' as const });
const fence = (raw: string, leadingTrivia = ''): CstNode => ({
	...parse(raw).children[0],
	leadingTrivia
});

describe('G1.145 a settled window reads back as itself', () => {
	it('passes blocks a reload divides the same way', () => {
		const { children } = parse('a\n\n```js\nx\n```\n\nb\n\n```\ny\n```\n');

		expect(checkSettledWindowReadsBack(body(children), 0, 1, defaultGrammarView)).toBeNull();
	});

	it('fails an unclosed fence standing above the block after it', () => {
		const children = [fence('```js\nopen\n'), { ...parse('b\n').children[0], leadingTrivia: '\n' }];

		const violation = checkSettledWindowReadsBack(body(children), 0, 0, defaultGrammarView);
		expect(violation?.code).toBe('settled-window-reads-back');
	});

	it('fails a closer below that pairs with the window otherwise than the tree holds', () => {
		const children = [fence('```js\ncode\n'), fence('```\n\ntext\n\n```py\nx\n```\n')];

		const violation = checkSettledWindowReadsBack(body(children), 0, 0, defaultGrammarView);
		expect(violation?.code).toBe('settled-window-reads-back');
	});
});
