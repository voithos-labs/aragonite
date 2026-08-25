import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { makeTopHarness } from '$lib/test/harness/editor-actions';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { registerBlockKind } from '$lib/schema/block-kind-descriptor';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { testClosure } from '$lib/test/support/closure';
import type { CstNode } from '$lib/core/nodes';

// Top-level/container event-path parity: both scopes emit the op's TARGET, never the
// snapshot index.

/** Non-editable and NOT a whole-block-focus target — the shape a caret-adjacent
 *  merge deletes. Every non-editable built-in now takes the focus path instead, so
 *  the delete branch is reachable only through a plugin kind. */
function inertNode(): CstNode {
	const kind = declarePluginKind('spec-inert-top-level');
	registerBlockKind(kind, {
		gapEdges: 'none',
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
		const h = makeTopHarness([inertNode(), ...parse('text\n').children]);
		await h.actions.mergeWithPrevious(1);
		expect(h.edits).toHaveLength(1);
		expect(h.edits[0]).toMatchObject({ op: 'delete', path: [0] });
	});

	it('forward-merge into a non-editable next block emits delete at the neighbor', async () => {
		const h = makeTopHarness([...parse('text\n').children, inertNode()]);
		await h.actions.mergeWithNext(0);
		expect(h.edits).toHaveLength(1);
		expect(h.edits[0]).toMatchObject({ op: 'delete', path: [1] });
	});

	// The focus-then-delete twin: press one mutates nothing, so there is no edit to report.
	it('backspace-merge into a thematic break emits no edit event', async () => {
		const h = makeTopHarness('---\n\ntext\n');
		await h.actions.mergeWithPrevious(1);
		expect(h.edits).toEqual([]);
	});

	it('descendToBody minting a body paragraph emits appendBlock at the minted index', async () => {
		const h = makeTopHarness('Title\n');
		await h.actions.descendToBody(0);
		expect(h.edits).toHaveLength(1);
		expect(h.edits[0]).toMatchObject({ op: 'appendBlock', path: [1] });
	});

	it('a kind-changing updateBlockContent emits updateContent at the block', async () => {
		const h = makeTopHarness('hello\n');
		await h.actions.updateBlockContent(0, '# hello\n', 0);
		const update = h.edits.find((e) => e.op === 'updateContent');
		expect(update).toBeDefined();
		expect(update!.path).toEqual([0]);
	});
});
