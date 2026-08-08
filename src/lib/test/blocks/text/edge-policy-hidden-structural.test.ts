// @vitest-environment jsdom
//
// The caret-edge dispatch's hidden-structural branch. A mode that hides a block's own marker
// prefix/suffix with no reveal puts unpainted bytes beside the caret; the guarantee is that a
// destructive key aimed at one takes nothing, so the no-op is the contract rather than a
// coincidence of what the engine happens to do beside non-rendered text.
// Miss-analysis: the edge-policy suites mount bare containers with no presentation root, so
// the marker-hiding modes had no fixture to fail in.
import { afterEach, describe, expect, it } from 'vitest';
import {
	createEdgePolicyDispatch,
	type EdgePolicyDispatchDeps
} from '$lib/components/blocks/text/edge-policy-dispatch';
import { parse } from '$lib/core/parser';
import { asRawOffset, type RawOffset } from '$lib/cursor/coordinate-spaces';
import type { BlockEditActions } from '$lib/action-contracts';
import type { CstNode } from '$lib/core/nodes';

interface Harness {
	handleKeydown: ReturnType<typeof createEdgePolicyDispatch>['handleKeydown'];
	edits: unknown[];
}

/** `source` as one block under an optional presentation root; markers ride their own spans. */
function mount(source: string, mode?: string): Harness {
	const node: CstNode = parse(source).children[0];
	const root = document.createElement('div');
	if (mode) root.setAttribute('data-presentation', mode);
	const el = document.createElement('div');
	el.setAttribute('contenteditable', 'true');
	el.textContent = node.raw.replace(/\n$/, '');
	root.appendChild(el);
	document.body.appendChild(root);

	const edits: unknown[] = [];
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
			updateBlockContent: (...args: unknown[]) => void edits.push(args)
		} as unknown as BlockEditActions,
		setPendingCursor: () => {},
		setSnapTarget: () => {},
		isRevealing: () => false,
		enterWidget: () => {},
		isReading: () => false,
		getEdgeAffinity: () => null
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

describe('a hidden structural prefix swallows Backspace at content start', () => {
	it('consumes the press and mutates nothing in live', () => {
		const h = mount('## Title\n', 'live');
		const e = key('Backspace');
		expect(h.handleKeydown(e, at(3))).toBe(true);
		expect(e.defaultPrevented).toBe(true);
		expect(h.edits).toHaveLength(0);
	});

	it('leaves the press alone mid-content', () => {
		const h = mount('## Title\n', 'live');
		expect(h.handleKeydown(key('Backspace'), at(4))).toBe(false);
	});

	// Raw 0 is unreachable in live, but if a stale read reports it the block-merge path
	// still owns the press — the swallow claims the content edge only.
	it('leaves raw 0 to the merge path', () => {
		const h = mount('## Title\n', 'live');
		expect(h.handleKeydown(key('Backspace'), at(0))).toBe(false);
	});

	it('leaves a paragraph, which has no structural prefix, to the merge path', () => {
		const h = mount('Title\n', 'live');
		expect(h.handleKeydown(key('Backspace'), at(0))).toBe(false);
	});

	// Source paints the `## `, so Backspace there deletes a byte the user can see.
	it('declines in source mode', () => {
		const h = mount('## Title\n', undefined);
		expect(h.handleKeydown(key('Backspace'), at(3))).toBe(false);
	});

	// The preview rungs reveal the focused block's own prefix, so its bytes are editable.
	for (const mode of ['preview-block', 'preview-inline']) {
		it(`declines in ${mode}`, () => {
			const h = mount('## Title\n', mode);
			expect(h.handleKeydown(key('Backspace'), at(3))).toBe(false);
		});
	}

	// A chord is a word-scoped platform command; the swallow owns only the plain press.
	it.each([{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }])(
		'declines %o+Backspace',
		(mods) => {
			const h = mount('## Title\n', 'live');
			expect(h.handleKeydown(key('Backspace', mods), at(3))).toBe(false);
		}
	);
});

describe('a hidden structural suffix swallows Delete at content end', () => {
	// `Title\n===`: the underline is structural, so content ends at 5.
	it('consumes the press at a setext heading’s content end in live', () => {
		const h = mount('Title\n===\n', 'live');
		const e = key('Delete');
		expect(h.handleKeydown(e, at(5))).toBe(true);
		expect(e.defaultPrevented).toBe(true);
		expect(h.edits).toHaveLength(0);
	});

	it('declines in source mode', () => {
		const h = mount('Title\n===\n', undefined);
		expect(h.handleKeydown(key('Delete'), at(5))).toBe(false);
	});

	// A heading's content runs to the block end, so Delete there is an ordinary merge.
	it('leaves an ATX heading’s end to the merge path', () => {
		const h = mount('## Title\n', 'live');
		expect(h.handleKeydown(key('Delete'), at(8))).toBe(false);
	});

	it('leaves Backspace at the same offset alone', () => {
		const h = mount('Title\n===\n', 'live');
		expect(h.handleKeydown(key('Backspace'), at(5))).toBe(false);
	});
});
