// @vitest-environment jsdom
//
// The composition funnel wired to the REAL block-edit actions + undo controller: a composed
// commit lands its bytes once and anchors its undo snapshot at the offset captured at
// compositionstart (what one Ctrl+Z restores — the browser-order counterpart lives in
// e2e/tests/ime-composition); a cancelled composition leaves the document byte-identical.
import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { makeEditorActionsDeps, type EditorActionsHarness } from '../harness/editor-actions';
import { makeSurface, type SurfaceHarness } from '../harness/editable-surface';

const SOURCE = 'hello world\n';

let harness: EditorActionsHarness;
let surface: SurfaceHarness;

beforeEach(() => {
	document.body.innerHTML = '';
	harness = makeEditorActionsDeps(parse(SOURCE).children);
	const controller = createUndoController(harness.deps);
	const blockEdit = createBlockEditActions(harness.deps, controller);
	surface = makeSurface((text, preEdit, saved) => {
		void blockEdit.updateBlockContent(0, text + '\n', preEdit, saved);
	});
	surface.el.textContent = 'hello world';
});

describe('composition commit through the real actions', () => {
	it('a composed commit lands once, anchored at the pre-composition offset', () => {
		surface.setCaret(11);
		surface.surface.onCompositionStart();
		surface.setCaret(13);
		surface.el.textContent = 'hello worldかん';
		surface.surface.onCompositionEnd();

		expect(serialize(harness.doc)).toBe('hello worldかん\n');

		// The whole composition is one debounced-batch snapshot: its selection is
		// the undo anchor, so one undo restores the pre-composition state.
		const undo = harness.deps.undoManager.getStacks().undo;
		expect(undo).toHaveLength(1);
		expect(undo[0].selection.anchor).toEqual({ path: [0], offset: 11 });
		expect(serialize(undo[0].snapshot)).toBe(SOURCE);
	});

	it('a cancelled composition leaves the document byte-identical', () => {
		surface.setCaret(11);
		surface.surface.onCompositionStart();
		surface.surface.onCompositionEnd();

		expect(serialize(harness.doc)).toBe(SOURCE);
	});
});
