// @vitest-environment jsdom
//
// `revealActiveEndpoint`'s text branch: the only caller of `parkCaret`, reachable only when the
// endpoint is windowed out. `parkCaret` is optional on `BlockComponent`, and the contract promises
// a specific degradation: no caret placed, the range survives, the scroll still runs. Pinned here
// because what must not happen (a fallback to the range-ending `focus`, or a throw) is invisible
// to every extend spec.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { CURSOR_START, type BlockComponent } from '$lib/block-component';
import { makeKeydownEnv, press } from './keydown-env';
import { allowDevWarns } from '$lib/test/support/warn-gate';

// The fixtures set table endpoints directly instead of through SelectionState, so the coordinate
// check sees the un-normalized point.
afterEach(() => allowDevWarns(['invariant:cross-block-endpoint-coordinates']));

const SOURCE = 'alpha\n\nbeta\n\ngamma\n';
/** The document-end leaf `Ctrl+Shift+End` extends to, held windowed out. */
const ENDPOINT = [2];

function endpointRef(withParkDoor: boolean): BlockComponent {
	const ref = {
		focus: vi.fn(),
		getCursorOffset: () => null,
		editable: true,
		focusable: true
	} as unknown as BlockComponent;
	if (withParkDoor) (ref as { parkCaret?: (offset: number) => void }).parkCaret = vi.fn();
	return ref;
}

function extendToOffWindowEnd(ref: BlockComponent) {
	const env = makeKeydownEnv(SOURCE, { revealTo: ref, offWindowPaths: [ENDPOINT] });
	env.selection.enterCrossBlock({ path: [0], offset: 1 }, { path: [1], offset: 2 });
	const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView');
	return { env, scrolled };
}

describe('revealActiveEndpoint parks in a revealed off-window endpoint', () => {
	it('parks through the park door, leaving the extend’s range live', async () => {
		const ref = endpointRef(true);
		const { env } = extendToOffWindowEnd(ref);

		expect(await env.keydown.handleKeyDown(press('End', { ctrlKey: true, shiftKey: true }))).toBe(
			true
		);

		expect(env.revealed).toContainEqual(ENDPOINT);
		expect(ref.parkCaret).toHaveBeenCalledWith(env.selection.focus!.offset);
		expect(ref.focus).not.toHaveBeenCalled();
		expect(env.selection.isCrossBlock).toBe(true);
		expect(env.selection.focus?.path).toEqual(ENDPOINT);
	});

	// Miss-analysis (GH #111): the cell branch placed a literal 0, and this suite pinned only the
	// text branch's offset; a start sentinel discarded by the cell's `parkCaret` was invisible.
	it('the cell arm parks the START sentinel, so the cell door clamps and classifies', async () => {
		const ref = endpointRef(true);
		const env = makeKeydownEnv('alpha\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n', {
			revealTo: ref
		});
		env.selection.enterCrossBlock({ path: [0], offset: 1 }, { path: [1], offset: 0 });
		vi.spyOn(Element.prototype, 'scrollIntoView');

		expect(await env.keydown.handleKeyDown(press('End', { ctrlKey: true, shiftKey: true }))).toBe(
			true
		);

		expect(env.revealed.some((path) => path.length === 3)).toBe(true);
		expect(ref.parkCaret).toHaveBeenCalledWith(CURSOR_START);
	});

	// The documented degradation. The range surviving is the half that matters: placing the
	// caret through `focus` instead would cancel the selection the user is still building.
	it('degrades to a missed park when the endpoint omits the door — no fallback, no throw', async () => {
		const ref = endpointRef(false);
		const { env, scrolled } = extendToOffWindowEnd(ref);

		expect(await env.keydown.handleKeyDown(press('End', { ctrlKey: true, shiftKey: true }))).toBe(
			true
		);

		expect(env.revealed).toContainEqual(ENDPOINT);
		expect(ref.focus).not.toHaveBeenCalled();
		expect(env.selection.isCrossBlock).toBe(true);
		expect(env.selection.focus?.path).toEqual(ENDPOINT);
		// The mount brought in the endpoint, so the scroll that follows still has an element; the
		// branch continues past the absent `parkCaret` rather than returning early.
		expect(scrolled).toHaveBeenCalled();
	});
});
