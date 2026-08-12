import { describe, it, expect, afterEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createInlineRangeCommit } from '$lib/editor-actions/inline-range-commit';
import { makeEditorActionsDeps, makeNestedHarness } from '$lib/test/harness/editor-actions';
import { rangeSelectionOf } from '$lib/test/support/undo-entry';
import type { EditEvent } from '$lib/editor-events';
import { allowDevWarns } from '$lib/test/support/warn-gate';

// The container fixtures are hand-built, not parser output, so the container-raw oracle reads
// them as stale.
afterEach(() => allowDevWarns(['invariant:stale-raw']));

// The one primitive both the image popover and the link card write through: splice bytes over a
// raw range in the leaf at `path`, as ONE undo entry, at any depth.

function makeTop(source: string) {
	const harness = makeEditorActionsDeps(parse(source).children);
	const controller = createUndoController(harness.deps);
	const edits: EditEvent[] = [];
	harness.events.on('edit', (e) => edits.push(e));
	return {
		deps: harness.deps,
		doc: harness.doc,
		controller,
		edits,
		commit: createInlineRangeCommit({ getDoc: () => harness.doc, controller })
	};
}

describe('inline-range commit — top level', () => {
	it('splices the bytes over the range and leaves the rest of the raw alone', async () => {
		const h = makeTop('Visit [x](old) now\n');
		await h.commit.commitInlineRange([0], 6, 14, '[x](new)', 6);
		expect(h.doc.children[0].raw).toBe('Visit [x](new) now\n');
	});

	it('emits one updateContent edit at the leaf it wrote', async () => {
		const h = makeTop('Visit [x](old) now\n');
		await h.commit.commitInlineRange([0], 6, 14, '[x](new)', 6);
		expect(h.edits).toHaveLength(1);
		expect(h.edits[0]).toMatchObject({ op: 'updateContent', path: [0] });
	});

	it('one undo entry holds the pre-splice bytes, so one Ctrl+Z is the whole edit', async () => {
		const h = makeTop('Visit [x](old) now\n');
		await h.commit.commitInlineRange([0], 6, 14, '[x](new)', 6);
		const stack = h.deps.undoManager.getStacks().undo;
		expect(stack).toHaveLength(1);
		expect(stack[0].snapshot.children[0].raw).toBe('Visit [x](old) now\n');
	});

	it('a byte-identical splice commits nothing, so a dismiss adds no undo entry', async () => {
		const h = makeTop('Visit [x](old) now\n');
		await h.commit.commitInlineRange([0], 6, 14, '[x](old)', 6);
		expect(h.edits).toEqual([]);
	});

	it('the entry restores the caret the caller asked for, not the block start', async () => {
		const h = makeTop('Visit [x](old) now\n');
		await h.commit.commitInlineRange([0], 6, 14, '[x](new)', 9);
		expect(rangeSelectionOf(h.deps.undoManager.getStacks().undo[0]).focus).toMatchObject({
			path: [0],
			offset: 9
		});
	});

	it('declines a path that resolves to nothing rather than write elsewhere', async () => {
		const h = makeTop('Visit [x](old) now\n');
		await h.commit.commitInlineRange([4], 0, 1, 'z', 0);
		expect(h.doc.children[0].raw).toBe('Visit [x](old) now\n');
		expect(h.edits).toEqual([]);
	});
});

describe('inline-range commit — nested', () => {
	it('writes through the container ceremony at a nested path', async () => {
		const h = makeNestedHarness('- Visit [x](old) now\n');
		const commit = createInlineRangeCommit({ getDoc: () => h.deps.doc, controller: h.controller });
		const item = h.getNode().children![0];
		const at = item.raw.indexOf('[x](old)');

		await commit.commitInlineRange([0, 0], at, at + 8, '[x](new)', at);

		expect(h.deps.doc.children[0].children![0].raw).toContain('[x](new)');
	});

	it('emits one updateContent edit at the nested leaf path', async () => {
		const h = makeNestedHarness('- Visit [x](old) now\n');
		const commit = createInlineRangeCommit({ getDoc: () => h.deps.doc, controller: h.controller });
		const edits: EditEvent[] = [];
		h.events.on('edit', (e) => edits.push(e));
		const at = h.getNode().children![0].raw.indexOf('[x](old)');

		await commit.commitInlineRange([0, 0], at, at + 8, '[x](new)', at);

		expect(edits).toHaveLength(1);
		expect(edits[0]).toMatchObject({ op: 'updateContent', path: [0, 0] });
	});
});
