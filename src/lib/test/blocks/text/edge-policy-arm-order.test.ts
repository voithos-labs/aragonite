// @vitest-environment jsdom
//
// The caret-edge dispatch's ORDER is the seam (G4.12): which gesture family outranks which decides
// every contested press, and a family inserted at the wrong rank changes behavior no single arm's
// tests can see. Miss-analysis: the order lived as nine literal `if` lines with no test naming it,
// so a reordering read as a refactor.
import { describe, expect, it } from 'vitest';
import {
	createEdgePolicyDispatch,
	type EdgePolicyDispatchDeps
} from '$lib/components/blocks/text/edge-policy-dispatch';
import { parse } from '$lib/core/parser';
import { trimTrailingLineEnding } from '$lib/core/lines';
import { asRawOffset } from '$lib/cursor/coordinate-spaces';
import type { BlockEditActions } from '$lib/action-contracts';
import { makePendingMarks } from '$lib/test/harness/editor-actions';

function mount(reading: boolean, source = 'hello world\n') {
	const node = parse(source).children[0];
	const el = document.createElement('div');
	el.setAttribute('contenteditable', 'true');
	el.textContent = trimTrailingLineEnding(node.raw);
	document.body.appendChild(el);

	const commits: string[] = [];
	const entered: { start: number; end: number }[] = [];
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
		hasIslands: () => true,
		getRawSelection: () => null,
		blockEdit: {
			updateBlockContent: (_index: number, raw: string) => commits.push(raw)
		} as unknown as BlockEditActions,
		setPendingCursor: () => {},
		setSnapTarget: () => {},
		isRevealing: () => false,
		enterWidget: (widget) => entered.push({ start: widget.start, end: widget.end }),
		isReading: () => reading,
		getEdgeAffinity: () => null,
		pendingMarks: makePendingMarks(),
		installedAs: 'block'
	};
	return { dispatch: createEdgePolicyDispatch(deps), node, commits, entered };
}

describe('the declared arm order', () => {
	const { dispatch } = mount(false);

	it('ranks the families as the design states, cut line included', () => {
		expect(dispatch.arms.map((arm) => arm.id)).toEqual([
			'pending-marks',
			'cst-widget',
			'reading-mode',
			'decoration-island',
			'ambient-marker',
			'hidden-suffix-delete',
			'construct-edge-delete',
			'marker-completion',
			'construct-seat'
		]);
	});

	it('gives every arm a reason, which is what a new entry has to supply', () => {
		expect(dispatch.arms.filter((arm) => arm.reason.trim() === '')).toEqual([]);
	});

	// The cut is an ENTRY, not a pre-check: the two arms above it still run in reading mode, and
	// everything below stands down. A hoisted gate would lose the first half.
	it('reading mode stops the walk at its cut and leaves the key unclaimed', () => {
		const e = new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true });
		expect(mount(true).dispatch.handleKeydown(e, asRawOffset(11))).toBe(false);
		expect(e.defaultPrevented).toBe(false);
	});

	// The other half of the same cut: the widget arm ABOVE it still runs, so an entity at the caret
	// takes the destructive press as a selection. Its atomic delete is the leg reading stands down,
	// which is why the arm reads the mode itself rather than being gated out of the walk.
	it('enters a widget at the caret in reading mode and commits nothing', () => {
		const b = mount(true, 'a&copy;b\n');
		const e = new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true });
		expect(b.dispatch.handleKeydown(e, asRawOffset(7))).toBe(true);
		expect(b.entered).toEqual([{ start: 1, end: 7 }]);
		expect(b.commits).toEqual([]);
		expect(e.defaultPrevented).toBe(true);
		expect(b.node.raw).toBe('a&copy;b\n');
	});
});
