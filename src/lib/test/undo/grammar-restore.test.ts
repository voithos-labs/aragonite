// An undo entry restores under the grammar the editor reads now, not the one it was pushed under.
// No mounted editor changes its grammar on this branch, so each row does what the plugin list's
// `use()` does: swap the reading's grammar and read the live document again. The integration row
// is `test/plugins/unit/editor-plugin-list.svelte.test.ts` on the plugin branch.

import { describe, expect, it, vi } from 'vitest';
import { createHistoryActions } from '#lib/editor-actions/commit/history.js';
import { makeTopHarness } from '#lib/test/harness/editor-actions.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { createGrammarView } from '#lib/schema/block-openers.js';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { assignIds } from '#lib/block-id.js';
import { byteOfLeaf, leafAtByte } from '#lib/tree-operations/container-offsets.js';
import { docPathFrom } from '#lib/core/coordinate-spaces.js';
import { grammarStamp, sameGrammar } from '#lib/editor-actions/commit/grammar-stamp.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { isGapSelection, type GapCaretSelection } from '#lib/selection/gap-caret.js';
import type { EditorSelection } from '#lib/selection/primitives.js';
import { checkRestoredUnderGrammar } from '#lib/invariants/reads-back.js';
import type { Document } from '#lib/core/nodes.js';

const withoutIndentedCode = createGrammarView((key) => key !== 'indentedCode');

/** Under the default grammar the indented lines are one code block; without it, paragraphs. */
const SOURCE = 'Keep\n\n    one\n\n    two\n';
const CARET = SOURCE.indexOf('two') + 1;

function setup() {
	const harness = makeTopHarness(SOURCE, { reading: fixtureReading() });
	const history = createHistoryActions(harness.deps, harness.controller);
	const restore = vi.spyOn(harness.deps.caretLanding, 'restore');
	return { ...harness, history, restore };
}

type Setup = ReturnType<typeof setup>;

/** One undo entry pushed under the editor's grammar, its caret on the `w` of `two`, for an
 *  edit that adds `insert` at the end of the last line. */
async function pushEntry({ controller, deps }: Setup, insert = '!'): Promise<void> {
	const end = serialize(deps.doc).length - 1;
	const wrote = await controller.commitSource({
		changes: [{ from: end, to: end, insert }],
		caret: { at: end + insert.length, holds: 'text' },
		op: { kind: 'input' },
		snapshot: { path: docPathFrom([1]), offset: CARET - SOURCE.indexOf('    one') }
	});
	expect(wrote).toBe(true);
}

/** What `use()` does: the editor reads another grammar, and the live document is read under it. */
function switchGrammar({ deps }: Setup): void {
	deps.reading = fixtureReading({ grammar: withoutIndentedCode });
	const reread = parse(serialize(deps.doc), { grammar: withoutIndentedCode });
	deps.setDoc(reread);
	deps.setBlockIds(assignIds(reread.children));
}

const kinds = ({ deps }: Setup) => deps.doc.children.map((b) => b.kind);

function restoredSelection({ restore }: Setup): EditorSelection {
	const selection = restore.mock.lastCall?.[0] as EditorSelection | GapCaretSelection | undefined;
	if (!selection || isGapSelection(selection)) throw new Error('no caret was put back');
	return selection;
}

describe('an undo across a grammar change', () => {
	it('puts back the entry bytes read under the grammar the editor reads now', async () => {
		const s = setup();
		await pushEntry(s);
		switchGrammar(s);
		await s.history.requestUndo();
		expect(serialize(s.deps.doc)).toBe(SOURCE);
		expect(kinds(s)).toEqual(
			parse(SOURCE, { grammar: withoutIndentedCode }).children.map((b) => b.kind)
		);
		expect(kinds(s)).not.toContain('indentedCode');
	});

	it('puts the caret back on the byte it held, in the block that holds it now', async () => {
		const s = setup();
		await pushEntry(s);
		switchGrammar(s);
		await s.history.requestUndo();
		const selection = restoredSelection(s);
		const now = parse(SOURCE, { grammar: withoutIndentedCode });
		expect(selection.focus).toEqual(leafAtByte(now, CARET));
		expect(byteOfLeaf(s.deps.doc, selection.focus.path, selection.focus.offset)).toBe(CARET);
	});

	it('keeps the blocks the undo left alone, ids included', async () => {
		const s = setup();
		await pushEntry(s);
		switchGrammar(s);
		const keep = s.deps.doc.children[0];
		const keepId = s.deps.blockIds[0];
		await s.history.requestUndo();
		expect(s.deps.doc.children[0]).toBe(keep);
		expect(s.deps.blockIds[0]).toBe(keepId);
	});

	// G1.9: the re-read writes no byte through a node the redo entries share, so each redo puts back
	// exactly the bytes it was pushed with.
	it('walks back and forth over two steps with every entry intact', async () => {
		const s = setup();
		await pushEntry(s, '!');
		await pushEntry(s, '?');
		switchGrammar(s);
		const steps = [serialize(s.deps.doc)];
		await s.history.requestUndo();
		steps.push(serialize(s.deps.doc));
		await s.history.requestUndo();
		expect(serialize(s.deps.doc)).toBe(SOURCE);
		await s.history.requestRedo();
		expect(serialize(s.deps.doc)).toBe(steps[1]);
		await s.history.requestRedo();
		expect(serialize(s.deps.doc)).toBe(steps[0]);
		expect(kinds(s)).not.toContain('indentedCode');
		expect(takeDevWarns()).toEqual([]);
	});

	// G1.156: the undo ends at its entry's bytes on the re-read path too.
	it('ends at the entry bytes and the redo at the bytes it replaced', async () => {
		const s = setup();
		await pushEntry(s);
		switchGrammar(s);
		const edited = serialize(s.deps.doc);
		await s.history.requestUndo();
		expect(serialize(s.deps.doc)).toBe(SOURCE);
		await s.history.requestRedo();
		expect(serialize(s.deps.doc)).toBe(edited);
		expect(kinds(s)).not.toContain('indentedCode');
	});

	it('installs the snapshot as it stands when the grammar did not change', async () => {
		const s = setup();
		await pushEntry(s);
		const entry = s.deps.undoManager.peekUndo()!;
		await s.history.requestUndo();
		expect(s.deps.doc.children).toEqual(entry.snapshot.children);
		expect(s.deps.doc.children[1]).toBe(entry.snapshot.children[1]);
		expect(kinds(s)).toContain('indentedCode');
	});
});

describe('the grammar an entry was read under', () => {
	it('matches a grammar built again over the same syntax, and no other', () => {
		const again = grammarStamp(createGrammarView((key) => key !== 'indentedCode'));
		expect(sameGrammar(grammarStamp(withoutIndentedCode), again)).toBe(true);
		expect(sameGrammar(grammarStamp(fixtureReading().grammar), again)).toBe(false);
	});
});

// Miss-analysis: every restore row held blocks that read back, so a block the read-back check
// already failed was reported again by each undo that put it back.
describe('the check on what an undo put back', () => {
	const indented = parse('    one\n').children;

	it('fails a block that read as itself under the entry grammar and not under the editor one', () => {
		expect(
			checkRestoredUnderGrammar(indented, withoutIndentedCode, fixtureReading().grammar)
		).toMatchObject({ code: 'restore-grammar' });
	});

	it('passes a block that reads as another tree under both', () => {
		const misread = [{ ...parse('Title\n').children[0], raw: '# Title\n' }];
		expect(
			checkRestoredUnderGrammar(misread, fixtureReading().grammar, fixtureReading().grammar)
		).toBeNull();
	});

	it('stays quiet when an undo puts back a snapshot block that never read back', async () => {
		const doc: Document = parse('Title\n\nNext\n');
		// A paragraph whose bytes read as a heading: the read-back check already fails it.
		doc.children[0] = { ...doc.children[0], raw: '# Title\n' };
		const s = makeTopHarness(doc, { reading: fixtureReading() });
		const history = createHistoryActions(s.deps, s.controller);
		vi.spyOn(s.deps.caretLanding, 'restore');
		const wrote = await s.controller.commitSource({
			changes: [{ from: 2, to: 7, insert: 'Name' }],
			caret: { at: 6, holds: 'text' },
			op: { kind: 'input' },
			snapshot: { path: docPathFrom([0]), offset: 0 }
		});
		expect(wrote).toBe(true);
		await history.requestUndo();
		expect(serialize(s.deps.doc)).toBe('# Title\n\nNext\n');
		expect(takeDevWarns()).toEqual([]);
	});
});
