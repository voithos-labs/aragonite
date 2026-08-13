import { describe, it, expect } from 'vitest';
import { planEnterCompletion, withEnterCompletion } from '$lib/editor-actions/enter-completion';
import { createBlockEditCore } from '$lib/editor-actions/block-edit-core';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import type { CommitScope, ScopeCommitArgs } from '$lib/editor-actions/block-edit-scope';
import { registerBlockCompleter } from '$lib/schema/block-completions';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { createSharingState } from '$lib/tree-operations/sharing';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import type { CstNode } from '$lib/core/nodes';
import type { BlockComponent } from '$lib/block-component';
import type { BlockEditActions } from '$lib/action-contracts';
import { makeEditorActionsDeps, makeNestedHarness } from '../harness/editor-actions';

// The split command's one completion arm: which presses reach a completer at all, and what the
// commit it routes to writes. The registry's own semantics live in test/schema, the table
// completer's line predicate in test/blocks/table.

const leaf = (raw: string): CstNode => parse(raw).children[0];

function pathFocusSpy() {
	const calls: { path: number[]; offset: number }[] = [];
	const ref = {
		focus: (offset: number) => calls.push({ path: [], offset }),
		focusByPath: (path: number[], offset: number) => calls.push({ path, offset })
	} as unknown as BlockComponent;
	return { calls, ref };
}

function stubScope(children: CstNode[], refs: (BlockComponent | undefined)[] = []) {
	const commits: ScopeCommitArgs[] = [];
	const sharing = createSharingState();
	const scope: CommitScope = {
		children: () => children,
		refAt: (i) => refs[i],
		collapseEmptyReplaceToDelete: false,
		async commit(args) {
			commits.push(args);
			args.mutate({
				children,
				sharing,
				owner: undefined,
				getPresentationMode: undefined,
				linkRef: undefined,
				unshareChild: (i) => children[i]
			});
			await args.afterTick?.();
		}
	};
	return { scope, commits, children };
}

/** The composed shape both wiring sites build: the consult wrapped around the core's split, with
 *  the core reachable underneath as the no-claim fallthrough. */
function seamOver(scope: CommitScope): BlockEditActions {
	const core = createBlockEditCore(scope);
	const consulted: Pick<BlockEditActions, 'splitBlock' | 'replaceBlock'> = {
		splitBlock: (i, offset) => core.split(i, offset),
		replaceBlock: (i, replacement, focus, options) =>
			core.replaceBlock(i, replacement, focus, options)
	};
	return withEnterCompletion(consulted as BlockEditActions, (index) => scope.children()[index]);
}

// A second registrant whose caret sits on a line the seam mints, which the table's cell-addressed
// caret cannot exercise. Kind-name order puts it ahead of `table`; its trigger is ordinary prose,
// so no other case in this file reaches it.
registerBlockCompleter(declarePluginKind('spec-fence'), {
	tryComplete: (line) =>
		line === 'fence me'
			? { lines: ['```', '', '```'], caret: { path: [], line: 1, column: 0 } }
			: null
});

describe('Enter completion — which presses reach a completer', () => {
	it('claims a lone header row with the caret at its end', () => {
		expect(planEnterCompletion(leaf('| a | b |\n'), 9)).not.toBeNull();
	});

	it('declines when the caret is anywhere but the end of the line', () => {
		for (const offset of [0, 4, 8]) {
			expect(planEnterCompletion(leaf('| a | b |\n'), offset)).toBeNull();
		}
	});

	// The grammar the completion opens is adjacent-line, so a paragraph already holding two
	// lines is not the lone typed line the completer was handed.
	it('declines a multi-line paragraph even when its last line would claim', () => {
		const paragraph = leaf('intro\n| a | b |\n');
		expect(paragraph.raw).toBe('intro\n| a | b |\n');
		expect(planEnterCompletion(paragraph, paragraph.raw.length - 1)).toBeNull();
	});

	// The firing gates are the prose merge role and the whole-raw content range; together they
	// keep a kind's own markers (an indent, a `# `) from ever reaching a completer as typed text.
	it.each([
		['    | a | b |\n', 'indentedCode'],
		['# | a | b |\n', 'heading'],
		['> | a | b |\n', 'blockquote'],
		['---\n', 'thematicBreak']
	])('declines %j, which parses as a non-prose kind', (raw, kind) => {
		const node = leaf(raw);
		expect(node.kind).toBe(kind);
		expect(planEnterCompletion(node, node.raw.length - 1)).toBeNull();
	});

	it('declines a line no completer claims, and a missing block', () => {
		expect(planEnterCompletion(leaf('just prose\n'), 10)).toBeNull();
		expect(planEnterCompletion(undefined, 0)).toBeNull();
	});

	it('takes the block’s own line ending into the minted bytes (G4.20)', () => {
		const plan = planEnterCompletion(leaf('| a | b |\r\n'), 9)!;
		expect(plan.replacement[0].raw).toBe('| a | b |\r\n| --- | --- |\r\n|  |  |\r\n');
	});

	// An unterminated tail line has no authored ending, so the mint takes the LF default and the
	// document ends terminated — the completion adds lines either way.
	it('terminates an unterminated tail line rather than leaving the mint open', () => {
		const plan = planEnterCompletion(leaf('| a | b |'), 9)!;
		expect(plan.replacement[0].raw).toBe('| a | b |\n| --- | --- |\n|  |  |\n');
	});
});

// A completer answers where the caret sits as a line and a column, because the seam picks the line
// ending AFTER the claim: a byte offset minted by the completer is one short on every CRLF block.
describe('Enter completion — the caret the seam resolves', () => {
	it.each([
		['fence me\n', 4],
		['fence me\r\n', 5]
	])('resolves line 1 column 0 against %j to offset %i', (raw, offset) => {
		const plan = planEnterCompletion(leaf(raw), 8)!;
		expect(plan.caret).toEqual({ path: [], offset });
	});

	// The table's caret addresses an empty cell, whose raw holds no lines at all — the resolution
	// must read that as column 0 in the cell rather than falling off the line list.
	it('resolves a path-addressed caret inside a childless empty cell', () => {
		const plan = planEnterCompletion(leaf('| a | b |\r\n'), 9)!;
		expect(plan.caret).toEqual({ path: [1, 0], offset: 0 });
	});
});

describe('Enter completion — what the composed split commits', () => {
	it('replaces the paragraph with one table and seats the caret in the first body cell', async () => {
		const cell = pathFocusSpy();
		const { scope, commits, children } = stubScope([leaf('| a | b |\n')], [cell.ref]);
		await seamOver(scope).splitBlock(0, 9);

		expect(children).toHaveLength(1);
		expect(children[0].kind).toBe('table');
		expect(children[0].raw).toBe('| a | b |\n| --- | --- |\n|  |  |\n');
		expect(commits).toHaveLength(1);
		expect(commits[0].op.kind).toBe('replaceBlock');
		expect(cell.calls).toEqual([{ path: [1, 0], offset: 0 }]);
	});

	// The undo snapshot anchors where the caret WAS, not where the mint sends it: restoring the
	// paragraph with the caret at 0 would put the next typed byte in front of the row.
	it('snapshots the caret at the end of the typed line, not at the cell it lands in', async () => {
		const { scope, commits } = stubScope([leaf('| a | b |\n')]);
		await seamOver(scope).splitBlock(0, 9);
		expect(commits[0].snapshot).toEqual({ index: 0, offset: 9 });
	});

	it('falls through to the ordinary split on a line no completer claims', async () => {
		const { scope, commits, children } = stubScope([leaf('| a | b |\n')]);
		await seamOver(scope).splitBlock(0, 4);
		expect(commits[0].op.kind).toBe('split');
		expect(children.map((c) => c.raw)).toEqual(['| a \n', '| b |\n']);
	});

	it('falls through on a single-cell row the table scan would reject', async () => {
		const { scope, commits, children } = stubScope([leaf('|a|\n')]);
		await seamOver(scope).splitBlock(0, 3);
		expect(commits[0].op.kind).toBe('split');
		expect(children).toHaveLength(2);
	});
});

describe('Enter completion — the document it leaves behind', () => {
	it('keeps a table above from absorbing the mint', async () => {
		const doc = parse('| A | B |\n| --- | --- |\n| 1 | 2 |\n\n| a | b |\n');
		expect(doc.children.map((c) => c.kind)).toEqual(['table', 'paragraph']);

		const { deps } = makeEditorActionsDeps(doc.children);
		const controller = createUndoController(deps);
		await createBlockEditActions(deps, controller).splitBlock(1, 9);

		expect(deps.doc.children.map((c) => c.kind)).toEqual(['table', 'table']);
		expect(serialize(deps.doc)).toBe(
			'| A | B |\n| --- | --- |\n| 1 | 2 |\n\n| a | b |\n| --- | --- |\n|  |  |\n'
		);
		// The separating blank line survived on the mint, so a reload sees two tables.
		expect(parse(serialize(deps.doc)).children).toHaveLength(2);
	});

	// In-container policy: complete in place; the blockquote rebuild reparses the mint as a
	// quoted table. The list item's split override routes around the seam entirely (#146).
	it('completes inside a blockquote and reparses as a quoted table', async () => {
		const h = makeNestedHarness('> | a | b |\n');
		await h.bundle.blockEdit.splitBlock(0, 9);

		expect(h.getNode().children!.map((c) => c.kind)).toEqual(['table']);
		const source = serialize(h.deps.doc);
		expect(source).toBe('> | a | b |\n> | --- | --- |\n> |  |  |\n');
		expect(parse(source).children[0].children!.map((c) => c.kind)).toEqual(['table']);
	});
});
