// A title row whose kind declares its own write rule takes the one-line rule after it, by position;
// the same kind written anywhere else takes its own rule alone.
// Miss-analysis: no chrome kind declares a write rule, so the composed rule had no row.
import { beforeEach, describe, expect, it } from 'vitest';
import { makeBlockNode, type CstNode, type PluginBlockKind } from '#lib/core/nodes.js';
import { legalizeWrite } from '#lib/tree-operations/content-write.js';
import { testContainer, testLeaf } from '#lib/test/harness/test-kinds.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';

let row: PluginBlockKind;
let container: PluginBlockKind;
// Per test, since the registries reset before each one.
beforeEach(() => {
	// Ends what it writes with a `!`, so an offset in the text maps to itself.
	row = testLeaf('spec-loud-title', {
		contextDependentKind: true,
		rawWrite: { normalize: (raw) => raw.replace(/\n?$/, '!$&'), mapOffset: (_, offset) => offset }
	});
	container = testContainer('spec-loud', { rebuildRaw: () => {}, reservedChrome: { kind: row } });
});

const { grammar } = fixtureReading();

function legal(index: number, text: string) {
	const owner = makeBlockNode({
		kind: container,
		leadingTrivia: '',
		raw: 'title\nbody\n'
	}) as CstNode;
	owner.children = [
		makeBlockNode({ kind: row, leadingTrivia: '', raw: 'title\n' }),
		makeBlockNode({ kind: row, leadingTrivia: '', raw: 'body\n' })
	];
	const parent = { children: owner.children, owner, lineEnding: '\n' as const };
	return legalizeWrite(parent, index, text, 'literal', grammar);
}

describe('a title row kind with a write rule of its own', () => {
	it('takes its own rule, then the one-line rule', () => {
		const write = legal(0, 'ti\ntle\n');
		expect(write.text).toBe('ti tle!\n');
		expect(write.storedOffset(3)).toBe(3);
	});

	it('takes its own rule alone away from the title row', () => {
		expect(legal(1, 'bo\ndy\n').text).toBe('bo\ndy!\n');
	});
});
