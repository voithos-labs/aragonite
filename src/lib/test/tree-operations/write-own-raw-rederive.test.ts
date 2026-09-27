import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { mergeIntoPrevDeepLeaf } from '../../tree-operations';
import { writeOwnRaw } from '../../tree-operations/node-primitives';
import { documentLineEnding } from '../../core/lines';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import { fixtureReading } from '../harness/fixture-grammar';
import { defaultGrammarView } from '$lib/schema/block-openers';

// The in-place write re-derives kind and parse-owned metadata from its bytes whether or not its own
// rule rewrote them, and the deep-leaf merge reparses what it absorbs.
// Miss-analysis: GH #54, the write's tests all went through the fence rule's rewrites.

describe('writeOwnRaw re-derives parse-owned metadata (GH #54)', () => {
	it('a heading write refreshes the level its bytes now carry', () => {
		const doc = parse('## ab\n');

		writeOwnRaw(doc.children[0], '# ab\n', documentLineEnding(doc), defaultGrammarView);

		expect(doc.children[0].metadata).toMatchObject({ level: 1 });
		expect(describeConvergence(doc)).toBeNull();
	});

	it('a fence write refreshes the info string', () => {
		const doc = parse('```js\nx\n```\n');

		writeOwnRaw(doc.children[0], '```ts\nx\n```\n', documentLineEnding(doc), defaultGrammarView);

		expect(doc.children[0].metadata).toMatchObject({ info: 'ts' });
		expect(describeConvergence(doc)).toBeNull();
	});
});

describe('mergeIntoPrevDeepLeaf re-derives what the absorbed bytes parse as (GH #54)', () => {
	it('a blank paragraph absorbing a heading becomes one', () => {
		const doc = parse('\n# h\n');
		expect(doc.children.map((c) => c.kind)).toEqual(['paragraph', 'heading']);

		const result = mergeIntoPrevDeepLeaf(doc, 1, undefined, fixtureReading());

		expect(result).not.toBeNull();
		expect(doc.children).toHaveLength(1);
		expect(doc.children[0].kind).toBe('heading');
		expect(doc.children[0].metadata).toMatchObject({ level: 1 });
		expect(serialize(doc)).toBe('# h\n');
		expect(describeConvergence(doc)).toBeNull();
	});

	it('a same-kind absorb stays in place and refreshes metadata', () => {
		const doc = parse('one\n\ntwo\n');
		const target = doc.children[0];

		mergeIntoPrevDeepLeaf(doc, 1, undefined, fixtureReading());

		expect(doc.children[0]).toBe(target);
		expect(doc.children[0].raw).toBe('onetwo\n');
		expect(describeConvergence(doc)).toBeNull();
	});
});
