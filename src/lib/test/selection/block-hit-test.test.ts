// @vitest-environment jsdom
//
// What `blockAtPoint` hands back for each combination of the two point→internals descriptor hooks.
// The `element` it returns is a per-CONSUMER answer: the drag consumers branch on
// `foreignDragHitTest` alone and fall back to a character hit test on `element`, so handing them
// the block WRAPPER yields a plausible-but-wrong offset across the whole subtree, not a decline.
// `table` declares both hooks, so only a test kind per combination can reach the hazard.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { blockAtPoint } from '$lib/selection/block-hit-test';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { registerBlockKind } from '$lib/schema/block-kind-descriptor';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { testClosure } from '$lib/test/support/closure';

const leaf = {
	mergeRole: 'not-mergeable',
	editable: true,
	supportsInline: false,
	closure: testClosure
} as const;

const CARET_TARGET = { path: [1, 2], offset: 7 };

describe('blockAtPoint hook plumbing', () => {
	let root: HTMLElement;
	let wrapper: HTMLElement;
	let editable: HTMLElement;
	const origFromPoint = document.elementFromPoint;

	beforeEach(() => {
		root = document.createElement('div');
		wrapper = document.createElement('div');
		wrapper.setAttribute('data-block-path', '[0]');
		editable = document.createElement('div');
		editable.setAttribute('contenteditable', 'true');
		wrapper.appendChild(editable);
		root.appendChild(wrapper);
		document.body.appendChild(root);
		// The press lands on the editable surface; the walk climbs to the wrapper.
		document.elementFromPoint = (() => editable) as typeof document.elementFromPoint;
	});

	afterEach(() => {
		document.elementFromPoint = origFromPoint;
		root.remove();
		__resetSchemaRegistriesForTests();
	});

	/** Register a kind with the given hooks and label the wrapper with it. */
	function withKind(name: string, hooks: Record<string, unknown>) {
		const kind = declarePluginKind(name);
		registerBlockKind(kind, { ...leaf, ...hooks });
		wrapper.setAttribute('data-block-kind', kind);
		return blockAtPoint(root, 10, 10);
	}

	it('gives a caret-only kind its EDITABLE surface, and still carries the caret hook', () => {
		// The load-bearing arm: a custom caret landing does not make a kind coordinate-addressed for a
		// drag, so the drag consumers keep a surface they can hit-test characters against.
		const hit = withKind('caretOnlyKind', { caretTargetAtPoint: () => CARET_TARGET });

		expect(hit?.element).toBe(editable);
		expect(hit?.foreignDragHitTest).toBeUndefined();
		expect(hit?.caretTargetAtPoint?.(10, 10)).toEqual(CARET_TARGET);
	});

	it('gives a drag-addressed kind the WRAPPER — it has no character surface to offer', () => {
		const hit = withKind('dragOnlyKind', { foreignDragHitTest: () => 5 });

		expect(hit?.element).toBe(wrapper);
		expect(hit?.foreignDragHitTest?.(10, 10)).toBe(5);
		expect(hit?.caretTargetAtPoint).toBeUndefined();
	});

	it('gives a kind declaring both the wrapper and both hooks (the table)', () => {
		const hit = withKind('bothHooksKind', {
			foreignDragHitTest: () => 5,
			caretTargetAtPoint: () => CARET_TARGET
		});

		expect(hit?.element).toBe(wrapper);
		expect(hit?.foreignDragHitTest?.(10, 10)).toBe(5);
		expect(hit?.caretTargetAtPoint?.(10, 10)).toEqual(CARET_TARGET);
	});

	it('gives a plain kind its editable surface and no hooks', () => {
		const hit = withKind('plainKind', {});

		expect(hit?.element).toBe(editable);
		expect(hit?.foreignDragHitTest).toBeUndefined();
		expect(hit?.caretTargetAtPoint).toBeUndefined();
	});

	it('falls back to the wrapper when a kind has no editable descendant', () => {
		editable.remove();
		document.elementFromPoint = (() => wrapper) as typeof document.elementFromPoint;
		const hit = withKind('noSurfaceKind', { caretTargetAtPoint: () => CARET_TARGET });

		expect(hit?.element).toBe(wrapper);
		expect(hit?.caretTargetAtPoint?.(10, 10)).toEqual(CARET_TARGET);
	});
});
