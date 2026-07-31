// @vitest-environment jsdom
//
// `revealActiveEndpoint`'s prose arm: the only caller of the park door, reachable only when the
// endpoint is windowed OUT. `parkCaret` is optional on `BlockComponent`, and the contract promises
// a specific degradation — no parked caret, the range survives, the scroll still runs. Pinned here
// because what must NOT happen (a fallback to the range-ending `focus`, or a throw) is invisible
// to every extend spec.
import { describe, it, expect, vi } from 'vitest';
import type { BlockComponent } from '$lib/block-component';
import { makeKeydownEnv, press } from './keydown-env';

const SOURCE = 'alpha\n\nbeta\n\ngamma\n';
/** The doc-end leaf `Ctrl+Shift+End` extends to, held off-window. */
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

	// The documented degradation. The range surviving is the half that matters: parking
	// through `focus` instead would cancel the selection the user is still building.
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
		// The reveal mounted the endpoint, so the scroll that follows the park still has
		// an element — the arm continues past the absent door rather than returning early.
		expect(scrolled).toHaveBeenCalled();
	});
});
