// @vitest-environment jsdom
//
// The caret-edge dispatch's hidden-structural branch, which now covers one side only: Delete at a
// block whose own structure sits AFTER its content. The merge that press would reach concatenates
// past the suffix and surfaces it, so the dispatch consumes the key. The prefix side left this
// arm with the demote (`merge-prev-demote.test.ts`) — the last row here is what pins that it did.
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
import { makePendingMarks } from '$lib/test/harness/editor-actions';

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
		get containerParent() {
			return null;
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
		getEdgeAffinity: () => null,
		pendingMarks: makePendingMarks(),
		installedAs: 'block'
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

describe('a hidden structural suffix swallows Delete at content end', () => {
	// `Title\n===`: the underline is structural, so content ends at 5.
	it('consumes the press at a setext heading’s content end in live', () => {
		const h = mount('Title\n===\n', 'live');
		const e = key('Delete');
		expect(h.handleKeydown(e, at(5))).toBe(true);
		expect(e.defaultPrevented).toBe(true);
		expect(h.edits).toHaveLength(0);
	});

	// Source paints the underline, so Delete there acts on bytes the user can see.
	it('declines in source mode', () => {
		const h = mount('Title\n===\n', undefined);
		expect(h.handleKeydown(key('Delete'), at(5))).toBe(false);
	});

	// The preview rungs reveal the focused block's own structure, so its bytes are editable.
	for (const mode of ['preview-block', 'preview-inline']) {
		it(`declines in ${mode}`, () => {
			const h = mount('Title\n===\n', mode);
			expect(h.handleKeydown(key('Delete'), at(5))).toBe(false);
		});
	}

	// A heading's content runs to the block end, so Delete there is an ordinary merge.
	it('leaves an ATX heading’s end to the merge path', () => {
		const h = mount('## Title\n', 'live');
		expect(h.handleKeydown(key('Delete'), at(8))).toBe(false);
	});

	it('leaves the press mid-content alone', () => {
		const h = mount('Title\n===\n', 'live');
		expect(h.handleKeydown(key('Delete'), at(3))).toBe(false);
	});

	// A chord is a word-scoped platform command; the swallow owns only the plain press.
	it.each([{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }])(
		'declines %o+Delete',
		(mods) => {
			const h = mount('Title\n===\n', 'live');
			expect(h.handleKeydown(key('Delete', mods), at(5))).toBe(false);
		}
	);
});

describe('the prefix side belongs to the block-edge command, not to this arm', () => {
	// The press falls through the whole dispatch so `block.mergePrev` can demote the heading; a
	// swallow here would silently take the gesture back.
	it.each([
		['a heading’s content start', '## Title\n', 3],
		['a setext heading’s content start', 'Title\n===\n', 0]
	])('declines Backspace at %s', (_case, source, offset) => {
		const h = mount(source, 'live');
		expect(h.handleKeydown(key('Backspace'), at(offset))).toBe(false);
		expect(h.edits).toHaveLength(0);
	});
});
