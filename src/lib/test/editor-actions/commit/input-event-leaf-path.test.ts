import { describe, it, expect } from 'vitest';
import { nodeAt } from '$lib/tree-operations/node-primitives';
import { lrdMapCouldChange } from '$lib/components/link-reference-map';
import { makeNestedHarness, makeTopHarness } from '$lib/test/harness/editor-actions';
import type { EditEvent } from '$lib/editor-events';

// Why the leaf path matters: `lrdMapCouldChange` reads the event path, so a container-level
// path hides a nested link-definition edit from the map rebuild.

function makeNestedTyping(source: string) {
	const { deps, events, bundle } = makeNestedHarness(source, { index: 0 });
	const edits: EditEvent[] = [];
	events.on('edit', (e) => edits.push(e));
	return { deps, bundle, edits };
}

describe('the input event carries the leaf path', () => {
	it('typing in a container-nested LRD emits the leaf path and reopens the LRD gate', async () => {
		const h = makeNestedTyping('> [a]: /url\n');
		expect(h.deps.doc.children[0].children![0].kind).toBe('linkReferenceDefinition');

		await h.bundle.blockEdit.updateBlockContent(0, '[a]: /url2\n', 'authored', 9);

		const input = h.edits.find((e) => e.op === 'input');
		expect(input).toBeDefined();
		expect(input!.path).toEqual([0, 0]);
		expect(nodeAt(h.deps.doc, input!.path)?.kind).toBe('linkReferenceDefinition');
		expect(lrdMapCouldChange(h.deps.doc, input!)).toBe(true);
	});

	it('typing in a container-nested paragraph still skips the LRD rebuild', async () => {
		const h = makeNestedTyping('> see [d][d]\n');

		await h.bundle.blockEdit.updateBlockContent(0, 'see [d][d]!\n', 'authored', 10);

		const input = h.edits.find((e) => e.op === 'input');
		expect(input).toBeDefined();
		expect(input!.path).toEqual([0, 0]);
		expect(lrdMapCouldChange(h.deps.doc, input!)).toBe(false);
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

		await actions.updateBlockContent(0, '#x\n', 'authored', 0, 1);
		await actions.updateBlockContent(0, '# x\n', 'authored', 1, 2);

		expect(nodeAt(h.deps.doc, path)?.kind).toBe('heading');
		expect(h.edits.map((e) => [e.op, e.path])).toEqual([
			['input', path],
			['updateContent', path]
		]);
	});
});
