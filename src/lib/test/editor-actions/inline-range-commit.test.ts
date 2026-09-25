import { describe, it, expect, afterEach } from 'vitest';
import { createInlineRangeCommit } from '$lib/editor-actions/inline-range-commit';
import { makeNestedHarness, makeTopHarness } from '$lib/test/harness/editor-actions';
import { rangeSelectionOf } from '$lib/test/support/undo-entry';
import type { EditEvent } from '$lib/editor-events';
import { allowDevWarns } from '$lib/test/support/warn-gate';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';

// The container fixtures are hand-built, not parser output, so the dev-mode stale-raw check
// reads them as stale.
afterEach(() => allowDevWarns(['invariant:stale-raw']));

// The one primitive both the image popover and the link card write through: splice bytes over
// a raw range in the leaf at `path`, as one undo entry, at any depth.

function makeTop(source: string) {
	const harness = makeTopHarness(source);
	return {
		...harness,
		commit: createInlineRangeCommit({
			getDoc: () => harness.doc,
			controller: harness.controller,
			grammar: harness.deps.grammar
		})
	};
}

describe('inline-range commit: top level', () => {
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

describe('inline-range commit: nested', () => {
	it('writes through the container commit sequence at a nested path', async () => {
		const h = makeNestedHarness('- Visit [x](old) now\n');
		const commit = createInlineRangeCommit({
			getDoc: () => h.deps.doc,
			controller: h.controller,
			grammar: h.deps.grammar
		});
		const item = h.getNode().children![0];
		const at = item.raw.indexOf('[x](old)');

		await commit.commitInlineRange([0, 0], at, at + 8, '[x](new)', at);

		expect(h.deps.doc.children[0].children![0].raw).toContain('[x](new)');
	});

	it('emits one updateContent edit at the nested leaf path', async () => {
		const h = makeNestedHarness('- Visit [x](old) now\n');
		const commit = createInlineRangeCommit({
			getDoc: () => h.deps.doc,
			controller: h.controller,
			grammar: h.deps.grammar
		});
		const edits: EditEvent[] = [];
		h.events.on('edit', (e) => edits.push(e));
		const at = h.getNode().children![0].raw.indexOf('[x](old)');

		await commit.commitInlineRange([0, 0], at, at + 8, '[x](new)', at);

		expect(edits).toHaveLength(1);
		expect(edits[0]).toMatchObject({ op: 'updateContent', path: [0, 0] });
	});
});

// Miss-analysis: every splice here wrote over existing bytes, and the one `open()` e2e typed its
// trigger mid-word, so no test ever filled or emptied a blank paragraph through this path.
describe('inline-range commit: a blank paragraph filled or emptied', () => {
	/** What a reload of the saved bytes reads, next to what the tree holds. */
	function reloadDiff(doc: { children: readonly { kind: string }[] }) {
		const reloaded = parse(serialize(doc as never)).children.map((node) => node.kind);
		return { live: doc.children.map((node) => node.kind), reloaded };
	}

	it('filling the blank line Enter made keeps a blank line on both sides of it', async () => {
		const h = makeTop('Above\n\n\nBelow\n');
		expect(h.doc.children.map((node) => node.raw.trim())).toEqual(['Above', '', 'Below']);
		await h.commit.commitInlineRange([1], 0, 0, '/', 1);
		expect(serialize(h.doc)).toBe('Above\n\n/\n\nBelow\n');
		const { live, reloaded } = reloadDiff(h.doc);
		expect(reloaded).toEqual(live);
	});

	it('emptying a line leaves the blank paragraph a reload reads back', async () => {
		const h = makeTop('Above\n\n/quote\n\nBelow\n');
		await h.commit.commitInlineRange([1], 0, 6, '', 0);
		const { live, reloaded } = reloadDiff(h.doc);
		expect(reloaded).toEqual(live);
		expect(parse(serialize(h.doc)).children.map((node) => node.raw)).toEqual(
			h.doc.children.map((node) => node.raw)
		);
	});

	it('emptying a line inside a container does the same', async () => {
		const h = makeNestedHarness('> Above\n>\n> /quote\n>\n> Below\n');
		const commit = createInlineRangeCommit({
			getDoc: () => h.deps.doc,
			controller: h.controller,
			grammar: h.deps.grammar
		});
		await commit.commitInlineRange([0, 1], 0, 6, '', 0);
		const quote = h.deps.doc.children[0];
		const reloaded = parse(serialize(h.deps.doc)).children[0];
		expect(reloaded.children?.map((node) => node.raw)).toEqual(
			quote.children?.map((node) => node.raw)
		);
	});
});
