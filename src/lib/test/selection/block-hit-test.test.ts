// @vitest-environment jsdom
//
// What `blockAtPoint` hands back for each combination of the two point→internals descriptor hooks.
// `charSurface` is the load-bearing answer: a kind with no character positions must report none,
// or a consumer hit-tests the block WRAPPER and gets a plausible-but-wrong offset across the whole
// subtree instead of a decline. `table` declares both hooks, so only test kinds reach every arm.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { blockAtPoint, endpointAtPoint, type BlockHit } from '$lib/selection/block-hit-test';
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

		expect(hit?.charSurface).toBe(editable);
		expect(hit?.foreignDragHitTest).toBeUndefined();
		expect(hit?.caretTargetAtPoint?.(10, 10)).toEqual(CARET_TARGET);
	});

	it('withdraws the surface from a drag-addressed kind — its editable is a CELL', () => {
		const hit = withKind('dragOnlyKind', { foreignDragHitTest: () => 5 });

		expect(hit?.charSurface).toBeNull();
		expect(hit?.foreignDragHitTest?.(10, 10)).toBe(5);
		expect(hit?.caretTargetAtPoint).toBeUndefined();
	});

	it('withdraws it from a kind declaring both hooks (the table)', () => {
		const hit = withKind('bothHooksKind', {
			foreignDragHitTest: () => 5,
			caretTargetAtPoint: () => CARET_TARGET
		});

		expect(hit?.charSurface).toBeNull();
		expect(hit?.foreignDragHitTest?.(10, 10)).toBe(5);
		expect(hit?.caretTargetAtPoint?.(10, 10)).toEqual(CARET_TARGET);
	});

	it('gives a plain kind its editable surface and no hooks', () => {
		const hit = withKind('plainKind', {});

		expect(hit?.charSurface).toBe(editable);
		expect(hit?.foreignDragHitTest).toBeUndefined();
		expect(hit?.caretTargetAtPoint).toBeUndefined();
	});

	// The mermaid shape: a rendered body with no editable in it. Reporting the wrapper here is
	// what let a drag mint a character offset out of an SVG's and a toolbar's text.
	it('reports no surface when a kind renders no editable descendant', () => {
		editable.remove();
		document.elementFromPoint = (() => wrapper) as typeof document.elementFromPoint;
		const hit = withKind('noSurfaceKind', { caretTargetAtPoint: () => CARET_TARGET });

		expect(hit?.charSurface).toBeNull();
		expect(hit?.caretTargetAtPoint?.(10, 10)).toEqual(CARET_TARGET);
	});
});

describe('endpointAtPoint — what a pointer may address', () => {
	const hit = (over: Partial<BlockHit> = {}): BlockHit => ({
		path: [2],
		charSurface: null,
		...over
	});

	it('addresses a surfaceless block as a whole unit', () => {
		expect(endpointAtPoint(hit(), 10, 10)).toEqual({ path: [2], wholeBlock: true });
	});

	it('addresses a coordinate kind by cell index, and declines off-grid', () => {
		expect(endpointAtPoint(hit({ foreignDragHitTest: () => 5 }), 10, 10)).toEqual({
			path: [2],
			offset: 5,
			cellCoordinate: true
		});
		expect(endpointAtPoint(hit({ foreignDragHitTest: () => null }), 10, 10)).toBeNull();
	});
});
