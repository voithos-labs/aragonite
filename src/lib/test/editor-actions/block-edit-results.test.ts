// Every block edit resolves to whether bytes landed, at the document root and inside a container:
// false when reading mode refuses it or it only moves focus, true when it writes.
// Miss-analysis: the results were typed, never tested, so a true after a refusal passed.
import { describe, expect, it } from 'vitest';
import type { BlockEditActions } from '$lib/action-contracts';
import type { EditorActionsDeps } from '$lib/editor-actions/deps';
import type { PresentationMode } from '$lib/presentation-mode';
import { serialize } from '$lib/core/serializer';
import { paragraphNode } from '$lib/tree-operations';
import { makeNestedHarness, makeTopHarness } from '../harness/editor-actions';
import { fixtureReading } from '../harness/fixture-grammar';
import { drainDevWarns } from '../support/warn-gate';

type Edit = (actions: BlockEditActions) => Promise<boolean>;

/** One call per member, each a real write on the second of two paragraphs. */
const WRITES: Record<keyof BlockEditActions, Edit> = {
	splitBlock: (a) => a.splitBlock(1, 1),
	descendToBody: (a) => a.descendToBody(1),
	insertParagraph: (a) => a.insertParagraph(2, 'new'),
	mergeWithPrevious: (a) => a.mergeWithPrevious(1),
	mergeWithNext: (a) => a.mergeWithNext(0),
	deleteBlock: (a) => a.deleteBlock(1),
	updateBlockContent: (a) => a.updateBlockContent(1, 'twox\n', 'authored', 3, 4),
	updateBlockMetadata: (a) => a.updateBlockMetadata(1, { note: 1 }),
	replaceBlock: (a) => a.replaceBlock(1, [paragraphNode('', 'new', '\n')])
};

const LEVELS = {
	'the document root': { source: 'one\n\ntwo\n', focusOnly: '---\n\ntwo\n' },
	'a container': { source: '> one\n>\n> two\n', focusOnly: '> ---\n>\n> two\n' }
} as const;

type Level = keyof typeof LEVELS;

const undos = (deps: EditorActionsDeps) => deps.undoManager.getStacks().undo.length;

function actionsAt(level: Level, source: string, mode: PresentationMode = 'source') {
	if (level === 'the document root') {
		const h = makeTopHarness(source, { reading: fixtureReading({}, mode) });
		return { actions: h.actions, bytes: () => serialize(h.deps.doc), entries: () => undos(h.deps) };
	}
	const h = makeNestedHarness(source, { index: 0, presentationMode: mode });
	return {
		actions: h.bundle.blockEdit,
		bytes: () => serialize(h.deps.doc),
		entries: () => undos(h.deps)
	};
}

describe.each(Object.keys(LEVELS) as Level[])('every block edit at %s', (level) => {
	const { source, focusOnly } = LEVELS[level];

	it.each(Object.keys(WRITES) as (keyof BlockEditActions)[])(
		'%s resolves true when it writes',
		async (member) => {
			const h = actionsAt(level, source);
			expect(await WRITES[member](h.actions)).toBe(true);
			// An undo entry, not the bytes: a metadata write can leave the bytes as they were.
			expect(h.entries()).toBe(1);
		}
	);

	it.each(Object.keys(WRITES) as (keyof BlockEditActions)[])(
		'%s resolves false when reading mode refuses it',
		async (member) => {
			const h = actionsAt(level, source, 'reading');
			expect(await WRITES[member](h.actions)).toBe(false);
			expect(h.bytes()).toBe(source);
			drainDevWarns();
		}
	);

	it('descendToBody onto a block that is already there resolves false', async () => {
		const h = actionsAt(level, source);
		expect(await h.actions.descendToBody(0)).toBe(false);
		expect(h.bytes()).toBe(source);
	});

	it('a merge refused by a whole-block neighbour, which only moves focus, resolves false', async () => {
		const h = actionsAt(level, focusOnly);
		expect(await h.actions.mergeWithPrevious(1)).toBe(false);
		expect(h.bytes()).toBe(focusOnly);
	});
});
