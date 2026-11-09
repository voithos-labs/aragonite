import { describe, it, expect } from 'vitest';
import { nodeAt } from '#lib/tree-operations/node-primitives.js';
import { makeNestedHarness, makeTopHarness } from '#lib/test/harness/editor-actions.js';
import type { EditEvent } from '#lib/editor-events.js';

// Why the leaf path matters: `input` tells a subscriber to read the block it names for its text,
// so a container's path would hand it the container's.

function makeNestedTyping(source: string) {
	const { deps, events, bundle } = makeNestedHarness(source, { index: 0 });
	const edits: EditEvent[] = [];
	events.on('edit', (e) => edits.push(e));
	return { deps, bundle, edits };
}

describe('the input event carries the leaf path', () => {
	it('typing in a container-nested leaf names the leaf', async () => {
		const h = makeNestedTyping('> [a]: /url\n');

		await h.bundle.blockEdit.updateBlockContent(0, '[a]: /url2\n', 'authored', 'join-typing', 9);

		const input = h.edits.find((e) => e.op === 'input');
		expect(input!.path).toEqual([0, 0]);
		expect(nodeAt(h.deps.doc, input!.path)?.kind).toBe('linkReferenceDefinition');
	});
});

// Miss-analysis: every input edit here came from a same-kind write, none from a kind change.
describe('a keystroke that changes the kind reports through its commit alone', () => {
	it.each([
		{ level: 'the top level', source: 'x\n', path: [0] },
		{ level: 'a quote', source: '> x\n', path: [0, 0] }
	])('in $level', async ({ source, path }) => {
		const h = path.length === 1 ? makeTopHarness(source) : makeNestedTyping(source);
		const actions = 'actions' in h ? h.actions : h.bundle.blockEdit;

		await actions.updateBlockContent(0, '#x\n', 'authored', 'join-typing', 0, 1);
		await actions.updateBlockContent(0, '# x\n', 'authored', 'join-typing', 1, 2);

		expect(nodeAt(h.deps.doc, path)?.kind).toBe('heading');
		expect(h.edits.map((e) => [e.op, e.path])).toEqual([
			['input', path],
			['updateContent', path]
		]);
	});
});
