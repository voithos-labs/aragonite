// G1.143: a kind's write rule never deletes bytes outside the written span, but an emptied block's
// own marker; both places that run a rule (the content write, a raw write) check it.
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { describe, it, expect } from 'vitest';
import type { CstNode } from '#lib/core/nodes.js';
import { parse } from '#lib/core/parser.js';
import { checkWriteRuleKeepsBytes } from '#lib/invariants/write-rule-keeps-bytes.js';
import { legalizeWrite } from '#lib/tree-operations/content-write.js';
import { normalizeOwnRaw } from '#lib/tree-operations/node-primitives.js';
import { testLeaf } from '#lib/test/harness/test-kinds.js';
import { takeDevWarns } from '../support/warn-gate';

const block = (raw: string): CstNode => ({ kind: 'paragraph', leadingTrivia: '', raw });

describe('G1.143 a write rule keeps the bytes the write left alone', () => {
	it('passes bytes the rule inserted around the written span', () => {
		expect(checkWriteRuleKeepsBytes(block('```js\n'), '```jsx\n', '```jsx\n```\n')).toBeNull();
	});

	it('passes a byte the rule took back out of the written span', () => {
		expect(checkWriteRuleKeepsBytes(block('```js\n'), '```j`s\n', '```js\n')).toBeNull();
	});

	it('fails a line below the written span the rule deleted', () => {
		const violation = checkWriteRuleKeepsBytes(
			block('```js\ncode\n```\n'),
			'X```js\ncode\n```\n',
			'X```js\ncode\n'
		);
		expect(violation?.code).toBe('write-rule-keeps-bytes');
		expect(violation?.message).toContain('from "```\\n" on');
	});

	describe('the one exception: the marker of the block the write emptied', () => {
		const heading = parse('Plan\n===\n').children[0];

		it('passes an underline dropped under a title the write left blank', () => {
			expect(checkWriteRuleKeepsBytes(heading, '\n===\n', '\n')).toBeNull();
		});

		it('fails an underline dropped under a title that kept its text', () => {
			expect(checkWriteRuleKeepsBytes(heading, 'Plans\n===\n', 'Plans\n')?.code).toBe(
				'write-rule-keeps-bytes'
			);
		});
	});

	it('fires through both places that run a kind’s rule', () => {
		const kind = testLeaf('drops-last-line', {
			rawWrite: {
				normalize: (raw) => raw.slice(0, raw.lastIndexOf('\n', raw.length - 2) + 1),
				mapOffset: (_raw, offset) => offset
			}
		});
		const node: CstNode = { kind, leadingTrivia: '', raw: 'a\nb\n' };
		const parent = { children: [node], owner: undefined, lineEnding: '\n' as const };

		legalizeWrite(parent, 0, 'Xa\nb\n', 'authored', defaultGrammarView);
		normalizeOwnRaw(node, 'Xa\nb\n', '\n');

		expect(takeDevWarns().map((w) => w.tag)).toEqual([
			'invariant:write-rule-keeps-bytes',
			'invariant:write-rule-keeps-bytes'
		]);
	});
});
