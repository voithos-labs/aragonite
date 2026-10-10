// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { createModeFlip } from '#lib/components/editor-root-mode-flip.js';
import { createEditorEvents } from '#lib/editor-events.js';
import { createDraftRegistry } from '#lib/components/draft-registry.js';
import { createDocumentStamps } from '#lib/editor-actions/commit/document-stamp.js';
import type { PresentationMode } from '#lib/presentation-mode.js';
import type { EditorSelection } from '#lib/selection/primitives.js';
import { settleEditor } from '#lib/test/harness/settle.js';
import { caretAt } from '#lib/test/harness/editor-selection.js';

afterEach(() => {
	document.body.replaceChildren();
});

// Miss-analysis: every mode-change test drove a mounted editor, never which mode captured.
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
		menuCloses: 0,
		gapClears: 0,
		selectionEmits: 0,
		modeEmits: [] as PresentationMode[],
		restores: [] as [number[], number][],
		/** The post half's steps in the order they ran. */
		order: [] as string[]
	};
	const selection = { isCrossBlock: false, gapCaret: null, clearGapCaret: () => calls.gapClears++ };
	const events = createEditorEvents();
	const drafts = createDraftRegistry(createDocumentStamps());
	events.on('presentationModeChange', (next) => {
		calls.modeEmits.push(next);
		calls.order.push('mode');
	});
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
		caretMemory: {
			forget: () => {
				calls.caretForgets++;
				calls.order.push('caret');
			}
		},
		layout: {
			forgetMeasuredHeights: () => {
				calls.measuredDrops++;
				calls.order.push('heights');
			}
		},
		menus: {
			closeAll: (cause) => {
				calls.menuCloses++;
				calls.order.push(`menus:${cause}`);
			}
		},
		drafts: {
			closeAll: (cause) => {
				calls.order.push(`drafts:${cause}`);
				drafts.closeAll(cause);
			}
		},
		events,
		restoreCaret: async (path, offset) => {
			calls.restores.push([path, offset]);
			calls.order.push('restore');
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
		drafts,
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
		expect(h.calls).toMatchObject({
			caretForgets: 0,
			measuredDrops: 0,
			menuCloses: 0,
			modeEmits: []
		});
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

	it('the post half closes the menus, forgets the mode’s geometry and announces the mode', () => {
		const h = harness();
		h.flipTo('live');
		expect(h.calls).toMatchObject({
			caretForgets: 1,
			measuredDrops: 1,
			menuCloses: 1,
			modeEmits: ['live']
		});
	});
});

// The blur in the first half commits a focused draft and ends it; the drafts close in the second
// half then reaches only one nothing focused, so no draft is written twice.
describe('editor-root mode flip: the drafts', () => {
	function draftOnLeaf(h: ReturnType<typeof harness>) {
		const writes: string[] = [];
		const draft = h.drafts.open({
			seed: 'x',
			current: () => 'x',
			close: (cause) => commit(`close:${cause}`)
		});
		function commit(how: string) {
			draft.end();
			writes.push(how);
		}
		h.leaf.addEventListener('blur', () => commit('blur'), { once: true });
		return writes;
	}

	it('a focused draft is written once, by its blur', () => {
		const h = harness();
		const writes = draftOnLeaf(h);
		h.leaf.focus();
		h.flipTo('live');
		expect(writes).toEqual(['blur']);
	});

	it('a draft nothing focused is written once, by the close', () => {
		const h = harness();
		const writes = draftOnLeaf(h);
		h.flipTo('live');
		h.flipTo('source');
		expect(writes).toEqual(['close:mode-change']);
	});
});

describe('editor-root mode flip: the caret carry', () => {
	it('restores the caret captured on the way out after the flush', async () => {
		const h = harness({ selection: caretAt([1], 3) });
		h.flipTo('live');
		await settleEditor();
		expect(h.calls.restores).toEqual([[[1], 3]]);
	});

	// Miss-analysis: the post half's steps were only counted, and a menu's close can write.
	it('closes the menus before anything else, so the restore reads the tree a close left', async () => {
		const h = harness({ selection: caretAt([1], 3) });
		h.flipTo('live');
		await settleEditor();
		expect(h.calls.order).toEqual([
			'menus:mode-change',
			'drafts:mode-change',
			'caret',
			'heights',
			'mode',
			'restore'
		]);
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
