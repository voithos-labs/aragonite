import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { registerBlockKind } from '$lib/schema/block-kind-descriptor';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { testClosure } from '$lib/test/support/closure';
import type { CstNode } from '$lib/core/nodes';
import type { EditEvent } from '$lib/editor-events';

// Top-level/container event-path parity: both scopes emit the op's TARGET, never the
// snapshot index.

function makeTopFrom(children: CstNode[]) {
	const harness = makeEditorActionsDeps(children);
	const controller = createUndoController(harness.deps);
	const actions = createBlockEditActions(harness.deps, controller);
	const edits: EditEvent[] = [];
	harness.events.on('edit', (e) => edits.push(e));
	return { deps: harness.deps, actions, edits };
}

const makeTop = (source: string) => makeTopFrom(parse(source).children);

/** Non-editable and NOT a whole-block-focus target — the shape a caret-adjacent
 *  merge deletes. Every non-editable built-in now takes the focus path instead, so
 *  the delete branch is reachable only through a plugin kind. */
function inertNode(): CstNode {
	const kind = declarePluginKind('spec-inert-top-level');
	registerBlockKind(kind, {
		mergeRole: 'not-mergeable',
		editable: false,
		supportsInline: false,
		closure: testClosure
	});
	return { kind, leadingTrivia: '', raw: 'inert\n' };
}

describe('top-level event paths target the operated block', () => {
	beforeEach(__resetSchemaRegistriesForTests);

	it('backspace-merge into a non-editable previous block emits delete at the neighbor', async () => {
		const h = makeTopFrom([inertNode(), ...parse('text\n').children]);
		await h.actions.mergeWithPrevious(1);
		expect(h.edits).toHaveLength(1);
		expect(h.edits[0]).toMatchObject({ op: 'delete', path: [0] });
	});

	it('forward-merge into a non-editable next block emits delete at the neighbor', async () => {
		const h = makeTopFrom([...parse('text\n').children, inertNode()]);
		await h.actions.mergeWithNext(0);
		expect(h.edits).toHaveLength(1);
		expect(h.edits[0]).toMatchObject({ op: 'delete', path: [1] });
	});

	// The focus-then-delete twin: press one mutates nothing, so there is no edit to report.
	it('backspace-merge into a thematic break emits no edit event', async () => {
		const h = makeTop('---\n\ntext\n');
		await h.actions.mergeWithPrevious(1);
		expect(h.edits).toEqual([]);
	});

	it('descendToBody minting a body paragraph emits appendBlock at the minted index', async () => {
		const h = makeTop('Title\n');
		await h.actions.descendToBody(0);
		expect(h.edits).toHaveLength(1);
		expect(h.edits[0]).toMatchObject({ op: 'appendBlock', path: [1] });
	});

	it('a kind-changing updateBlockContent emits updateContent at the block', async () => {
		const h = makeTop('hello\n');
		await h.actions.updateBlockContent(0, '# hello\n', 0);
		const update = h.edits.find((e) => e.op === 'updateContent');
		expect(update).toBeDefined();
		expect(update!.path).toEqual([0]);
	});
});
