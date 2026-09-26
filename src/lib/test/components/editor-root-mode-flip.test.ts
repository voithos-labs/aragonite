// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { createModeFlip } from '$lib/components/editor-root-mode-flip';
import { createEditorEvents } from '$lib/editor-events';
import type { PresentationMode } from '$lib/presentation-mode';
import type { EditorSelection } from '$lib/selection/primitives';
import { settleEditor } from '$lib/test/harness/settle';

afterEach(() => {
	document.body.replaceChildren();
});

const caretAt = (path: number[], offset: number): EditorSelection => ({
	anchor: { path, offset },
	focus: { path, offset }
});

// Miss-analysis: every mode-change test drove a mounted editor, where the caret coming back
// could be the restore path's doing; nothing pinned which mode captured and which restored.
function harness(opts: { mode?: PresentationMode; selection?: EditorSelection | null } = {}) {
	const root = document.createElement('div');
	const leaf = document.createElement('button');
	const header = document.createElement('div');
	const headerField = document.createElement('button');
	header.append(headerField);
	root.append(header, leaf);
	document.body.append(root);

	let mode: PresentationMode = opts.mode ?? 'source';
	let snapshot = opts.selection ?? null;
	let held: PresentationMode | null = null;
	const calls = {
		caretForgets: 0,
		measuredDrops: 0,
		gapClears: 0,
		selectionEmits: 0,
		modeEmits: [] as PresentationMode[],
		restores: [] as [number[], number][]
	};
	const selection = { isCrossBlock: false, gapCaret: null, clearGapCaret: () => calls.gapClears++ };
	const events = createEditorEvents();
	events.on('presentationModeChange', (next) => calls.modeEmits.push(next));
	const flip = createModeFlip({
		get editorEl() {
			return root;
		},
		get mode() {
			return mode;
		},
		selection,
		getSelection: () => snapshot,
		announceSelection: () => calls.selectionEmits++,
		getBlockElByPath: () => null,
		isHostChrome: (node) => !!node && header.contains(node),
		caretMemory: { forget: () => calls.caretForgets++ },
		heightOracle: { dropMeasured: () => calls.measuredDrops++ },
		events,
		restoreCaret: async (path, offset) => {
			calls.restores.push([path, offset]);
		},
		holdOutgoingMode: (next) => {
			held = next;
		}
	});
	/** Both halves in effect order, the mode already moved as the derived would have. */
	const flipTo = (to: PresentationMode) => {
		mode = to;
		flip.beforeFlip(to);
		flip.afterFlip(to);
	};
	const setMode = (next: PresentationMode) => (mode = next);
	const setSnapshot = (next: EditorSelection | null) => (snapshot = next);
	return {
		leaf,
		headerField,
		flip,
		calls,
		selection,
		flipTo,
		setMode,
		setSnapshot,
		held: () => held
	};
}

describe('editor-root mode flip: the outgoing mode', () => {
	// Miss-analysis: the blur's commit was only checked for its bytes, never for the mode it saw.
	it('is held only while the blur commits, so that write lands in the mode it was typed in', () => {
		const h = harness({ mode: 'source' });
		let heldAtBlur: PresentationMode | null | undefined;
		h.leaf.addEventListener('blur', () => (heldAtBlur = h.held()));
		h.leaf.focus();

		h.flipTo('reading');

		expect(heldAtBlur).toBe('source');
		expect(h.held()).toBeNull();
	});
});

describe('editor-root mode flip: the two halves', () => {
	it('an unchanged mode is a no-op for both halves', () => {
		const h = harness();
		h.flip.beforeFlip('source');
		h.flip.afterFlip('source');
		expect(h.calls).toMatchObject({ caretForgets: 0, measuredDrops: 0, modeEmits: [] });
	});

	it('the pre half blurs a focused leaf and announces the dropped selection', () => {
		const h = harness();
		h.leaf.focus();
		h.flip.beforeFlip('live');
		expect(document.activeElement).not.toBe(h.leaf);
		expect(h.calls.selectionEmits).toBe(1);
	});

	it('the pre half leaves host chrome focused', () => {
		const h = harness();
		h.headerField.focus();
		h.flip.beforeFlip('live');
		expect(document.activeElement).toBe(h.headerField);
		expect(h.calls.selectionEmits).toBe(0);
	});

	it('the post half forgets the caret memory, drops measured heights and announces the mode', () => {
		const h = harness();
		h.flipTo('live');
		expect(h.calls).toMatchObject({ caretForgets: 1, measuredDrops: 1, modeEmits: ['live'] });
	});
});

describe('editor-root mode flip: the caret carry', () => {
	it('restores the caret captured on the way out after the flush', async () => {
		const h = harness({ selection: caretAt([1], 3) });
		h.flipTo('live');
		await settleEditor();
		expect(h.calls.restores).toEqual([[[1], 3]]);
	});

	it('entering reading clears the gap caret and restores nothing', async () => {
		const h = harness({ selection: caretAt([1], 3) });
		h.flipTo('reading');
		await settleEditor();
		expect(h.calls.gapClears).toBe(1);
		expect(h.calls.restores).toEqual([]);
	});

	it('reading keeps its entry snapshot: a round trip through it lands the caret it entered with', async () => {
		const h = harness({ selection: caretAt([2], 5) });
		h.flipTo('reading');
		h.setSnapshot(null);
		h.flipTo('source');
		await settleEditor();
		expect(h.calls.restores).toEqual([[[2], 5]]);
	});

	it('a cross-block range captures no caret', async () => {
		const h = harness({ selection: caretAt([1], 3) });
		h.selection.isCrossBlock = true;
		h.flipTo('live');
		await settleEditor();
		expect(h.calls.restores).toEqual([]);
	});

	it('yields when the mode moved again before the flush', async () => {
		const h = harness({ selection: caretAt([1], 3) });
		h.flipTo('live');
		h.setMode('source');
		await settleEditor();
		expect(h.calls.restores).toEqual([]);
	});

	it('yields to a text-entry surface that took focus meanwhile', async () => {
		const h = harness({ selection: caretAt([1], 3) });
		h.flipTo('live');
		const field = document.createElement('input');
		document.body.append(field);
		field.focus();
		await settleEditor();
		expect(h.calls.restores).toEqual([]);
	});
});
