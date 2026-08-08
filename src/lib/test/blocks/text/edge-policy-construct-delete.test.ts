// @vitest-environment jsdom
//
// The caret-edge dispatch's destructive arm at an inline construct. A mode that paints no marker
// puts delimiter bytes beside the caret that no reader can aim at, so the press is intercepted and
// the CONTENT character goes instead — and with it the pair the cut empties, in the same commit.
// Miss-analysis: the pure rewrite can be exercised anywhere, but nothing pinned WHICH presses the
// dispatch hands it, and the mode gate is the whole difference between live and every other rung.
import { afterEach, describe, expect, it } from 'vitest';
import {
	createEdgePolicyDispatch,
	type EdgePolicyDispatchDeps
} from '$lib/components/blocks/text/edge-policy-dispatch';
import { parse } from '$lib/core/parser';
import { asRawOffset, type RawOffset } from '$lib/cursor/coordinate-spaces';
import type { BlockEditActions } from '$lib/action-contracts';
import type { CstNode } from '$lib/core/nodes';
import { makePendingMarks } from '$lib/test/harness/editor-actions';

interface Harness {
	handleKeydown: ReturnType<typeof createEdgePolicyDispatch>['handleKeydown'];
	/** `updateBlockContent` argument tuples, newest last. */
	edits: [number, string, number, number][];
}

/** `source` as one block under an optional presentation root. */
function mount(source: string, mode?: string): Harness {
	const node: CstNode = parse(source).children[0];
	const root = document.createElement('div');
	if (mode) root.setAttribute('data-presentation', mode);
	const el = document.createElement('div');
	el.setAttribute('contenteditable', 'true');
	el.textContent = node.raw.replace(/\n$/, '');
	root.appendChild(el);
	document.body.appendChild(root);

	const edits: Harness['edits'] = [];
	const deps: EdgePolicyDispatchDeps = {
		get node() {
			return node;
		},
		get index() {
			return 0;
		},
		get linkRef() {
			return undefined;
		},
		getEl: () => el,
		getAmbientLength: () => 0,
		hasIslands: () => false,
		getRawSelection: () => null,
		blockEdit: {
			updateBlockContent: (...args: unknown[]) => void edits.push(args as Harness['edits'][number])
		} as unknown as BlockEditActions,
		setPendingCursor: () => {},
		setSnapTarget: () => {},
		isRevealing: () => false,
		enterWidget: () => {},
		isReading: () => false,
		getEdgeAffinity: () => null,
		pendingMarks: makePendingMarks()
	};
	return { handleKeydown: createEdgePolicyDispatch(deps).handleKeydown, edits };
}

const key = (name: string, modifiers: Partial<KeyboardEvent> = {}) =>
	new KeyboardEvent('keydown', { key: name, cancelable: true, ...modifiers });

const at = (offset: number) => asRawOffset(offset) as RawOffset;

afterEach(() => {
	document.body.innerHTML = '';
	window.getSelection()?.removeAllRanges();
});

describe('a destructive key past a construct edge takes the content byte', () => {
	it('rewrites through the CST and anchors the undo entry at the pre-edit caret', () => {
		const h = mount('Some **bold** text\n', 'live');
		const e = key('Backspace');
		expect(h.handleKeydown(e, at(13))).toBe(true);
		expect(e.defaultPrevented).toBe(true);
		expect(h.edits).toEqual([[0, 'Some **bol** text\n', 13, 10]]);
	});

	it('drops the delimiters the cut empties in the same commit', () => {
		const h = mount('**b** tail\n', 'live');
		expect(h.handleKeydown(key('Backspace'), at(3))).toBe(true);
		expect(h.edits).toEqual([[0, ' tail\n', 3, 0]]);
	});

	it('takes the first content byte on Delete at a leading run', () => {
		const h = mount('**bold** x\n', 'live');
		expect(h.handleKeydown(key('Delete'), at(0))).toBe(true);
		expect(h.edits).toEqual([[0, '**old** x\n', 0, 0]]);
	});

	// Away from every hidden run the engine is right and owns the press, grapheme and IME
	// behavior included.
	it('leaves an ordinary content byte to native', () => {
		const h = mount('Some **bold** text\n', 'live');
		expect(h.handleKeydown(key('Backspace'), at(9))).toBe(false);
		expect(h.edits).toHaveLength(0);
	});

	// The bytes past the content range are the block's own, so this arm writes nothing there
	// however the block-edge path answers the press.
	it('writes nothing at a heading’s content start', () => {
		const h = mount('## **b** x\n', 'live');
		h.handleKeydown(key('Backspace'), at(3));
		expect(h.edits).toHaveLength(0);
	});
});

describe('the arm claims a press only where the markers are unpainted', () => {
	it('declines in source mode, which paints every delimiter', () => {
		const h = mount('Some **bold** text\n', undefined);
		expect(h.handleKeydown(key('Backspace'), at(13))).toBe(false);
		expect(h.edits).toHaveLength(0);
	});

	// The preview rungs reveal the focused construct, so its delimiters are editable bytes.
	for (const mode of ['preview-block', 'preview-inline']) {
		it(`declines in ${mode}`, () => {
			const h = mount('Some **bold** text\n', mode);
			expect(h.handleKeydown(key('Backspace'), at(13))).toBe(false);
		});
	}

	// A chord is a word-scoped platform command; the arm owns only the plain press.
	it.each([{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }])(
		'declines %o+Backspace',
		(mods) => {
			const h = mount('Some **bold** text\n', 'live');
			expect(h.handleKeydown(key('Backspace', mods), at(13))).toBe(false);
		}
	);
});
