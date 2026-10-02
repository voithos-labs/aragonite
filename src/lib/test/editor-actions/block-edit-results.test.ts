// Every block edit resolves to whether bytes landed, at the document root and inside a container:
// false when reading mode refuses it or it only moves focus, true when it writes.
// Miss-analysis: the results were typed, never tested, so a true after a refusal passed.
import { beforeEach, describe, expect, it } from 'vitest';
import type { BlockEditActions } from '$lib/action-contracts';
import { definePlugin, installPlugins } from '$lib/schema/plugin-install';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { registerBlockCompleter } from '$lib/schema/block-completions';
import type { EditorActionsDeps } from '$lib/editor-actions/deps';
import type { PresentationMode } from '$lib/presentation-mode';
import { serialize } from '$lib/core/serializer';
import { paragraphNode } from '$lib/tree-operations';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { footnotesPlugin } from '$lib/plugins/footnotes';
import { makeContainerHarness, makeNestedHarness, makeTopHarness } from '../harness/editor-actions';
import { fixtureReading } from '../harness/fixture-grammar';
import { allowDevWarns, drainDevWarns } from '../support/warn-gate';

type Edit = (actions: BlockEditActions) => Promise<boolean>;

// An on-type completer that takes the second paragraph's line, so completing it is a write.
const twoBox = definePlugin({
	name: 'two-box',
	setup() {
		registerBlockCompleter(declarePluginKind('two-box'), {
			onType: true,
			tryComplete: (line) =>
				line === 'two' ? { lines: ['two', 'x'], caret: { path: [], line: 1, column: 0 } } : null
		});
	}
});
beforeEach(() => {
	installPlugins([twoBox]);
});

/** One call per member, each a real write on the second of two paragraphs; the marker's space has
 *  a fixture of its own, below. */
const WRITES: Record<Exclude<keyof BlockEditActions, 'completeMarker'>, Edit> = {
	splitBlock: (a) => a.splitBlock(1, 1),
	descendToBody: (a) => a.descendToBody(1),
	insertParagraph: (a) => a.insertParagraph(2, 'new'),
	mergeWithPrevious: (a) => a.mergeWithPrevious(1),
	mergeWithNext: (a) => a.mergeWithNext(0),
	deleteBlock: (a) => a.deleteBlock(1, 'keyless'),
	updateBlockContent: (a) => a.updateBlockContent(1, 'twox\n', 'authored', 3, 4),
	completeLineOnType: (a) => a.completeLineOnType(1, 3),
	updateBlockMetadata: (a) => a.updateBlockMetadata(1, { note: 1 }),
	replaceBlock: (a) =>
		a.replaceBlock(1, [paragraphNode('', 'new', '\n')], undefined, { snapshotOffset: 0 })
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

	it.each(Object.keys(WRITES) as (keyof typeof WRITES)[])(
		'%s resolves true when it writes',
		async (member) => {
			const h = actionsAt(level, source);
			expect(await WRITES[member](h.actions)).toBe(true);
			// An undo entry, not the bytes: a metadata write can leave the bytes as they were.
			expect(h.entries()).toBe(1);
			// The metadata write stores a field no reload gives a paragraph.
			if (member === 'updateBlockMetadata') allowDevWarns(['invariant:reads-back']);
		}
	);

	it.each(Object.keys(WRITES) as (keyof typeof WRITES)[])(
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

describe('completeMarker, the space that finishes a container marker', () => {
	it('writes the space as one undo entry where the marker lacks it', async () => {
		const h = actionsAt('a container', '>abc\n');
		expect(await h.actions.completeMarker(0)).toBe(true);
		expect(h.bytes()).toBe('> abc\n');
		expect(h.entries()).toBe(1);
	});

	it.each([
		['at the document root', 'the document root', 'abc\n', 'source'],
		['where the marker has its space', 'a container', '> abc\n', 'source'],
		['in reading mode', 'a container', '>abc\n', 'reading']
	] as const)('resolves false %s', async (_name, level, source, mode) => {
		const h = actionsAt(level, source, mode);
		expect(await h.actions.completeMarker(0)).toBe(false);
		expect(h.bytes()).toBe(source);
		drainDevWarns();
	});

	// Miss-analysis: the press and this action each tested the marker their own way and only the
	// press asked the kind, so no row drove the action in a kind that takes no space.
	it.each([
		['a footnote definition', '[^1]:abc\n'],
		['a GitHub alert', '> [!NOTE]\n>abc\n']
	])(
		'resolves false and writes nothing in %s, whose marker takes no space',
		async (_name, source) => {
			installPlugins([admonitionsPlugin(), footnotesPlugin()]);
			const h = makeContainerHarness(source, [0]);
			expect(await h.bundle.blockEdit.completeMarker(0)).toBe(false);
			expect(serialize(h.deps.doc)).toBe(source);
			expect(h.deps.undoManager.getStacks().undo).toHaveLength(0);
		}
	);
});
