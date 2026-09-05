import { describe, it, expect } from 'vitest';
import type { EditEvent } from '$lib/editor-events';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createFocusActions } from '$lib/editor-actions/focus/focus';
import { parse } from '$lib/core/parser';
import { makeEditorActionsDeps } from './harness/editor-actions';

describe('moveFocus past the last block', () => {
	it('emits op=appendBlock and no op=split', async () => {
		const { deps, doc, events } = makeEditorActionsDeps([
			{ kind: 'paragraph', leadingTrivia: '\n', raw: 'hello\n' } as any
		]);
		const captured: EditEvent[] = [];
		events.on('edit', (e) => captured.push(e));

		const focus = createFocusActions(deps, createUndoController(deps));

		await focus.moveFocus(doc.children.length, 'start');

		const appendEvents = captured.filter((e) => e.op === 'appendBlock');
		const splitEvents = captured.filter((e) => e.op === 'split');

		expect(appendEvents).toHaveLength(1);
		expect(splitEvents).toHaveLength(0);
		expect(appendEvents[0].path).toEqual([1]);
	});

	// Separator and paragraph are both pure line ending, so both take the document's
	// (G4.20) — a defaulted `\n` pair puts two lone LFs at the end of a CRLF file.
	it('takes the last block’s line ending for both the separator and the paragraph', async () => {
		const { deps, doc } = makeEditorActionsDeps(parse('hello\r\n').children);
		const focus = createFocusActions(deps, createUndoController(deps));

		await focus.moveFocus(doc.children.length, 'start');

		expect(doc.children[1].leadingTrivia).toBe('\r\n');
		expect(doc.children[1].raw).toBe('\r\n');
	});

	it('with { append: false } is a no-op at the document end — no block, no event', async () => {
		const { deps, doc, events } = makeEditorActionsDeps([
			{ kind: 'paragraph', leadingTrivia: '\n', raw: 'hello\n' } as any
		]);
		const captured: EditEvent[] = [];
		events.on('edit', (e) => captured.push(e));

		const controller = createUndoController(deps);
		const focus = createFocusActions(deps, controller);

		await focus.moveFocus(doc.children.length, 'start', { append: false });

		expect(doc.children).toHaveLength(1);
		expect(captured).toHaveLength(0);
	});
});
