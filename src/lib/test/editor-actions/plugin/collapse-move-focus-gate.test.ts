import { describe, expect, it, vi } from 'vitest';
import { gateMoveFocusOnCollapse } from '$lib/editor-actions/plugin/container';
import type { FocusActions } from '$lib/action-contracts';

function stubParentFocus() {
	return {
		moveFocus: vi.fn(),
		revealPath: vi.fn(async () => null)
	} satisfies FocusActions;
}

describe('gateMoveFocusOnCollapse', () => {
	it('collapsed body target: delegates past the container, skipping the inner dispatch', async () => {
		const moveWithin = vi.fn();
		const parentFocus = stubParentFocus();
		const gated = gateMoveFocusOnCollapse(
			() => true,
			moveWithin,
			parentFocus,
			() => 3
		);

		await gated(1, 'start');

		expect(parentFocus.moveFocus).toHaveBeenCalledExactlyOnceWith(4, 'start');
		expect(moveWithin).not.toHaveBeenCalled();
	});

	it('collapsed body target: forwards options to the parent delegation', async () => {
		const moveWithin = vi.fn();
		const parentFocus = stubParentFocus();
		const gated = gateMoveFocusOnCollapse(
			() => true,
			moveWithin,
			parentFocus,
			() => 0
		);

		await gated(2, 'end', { append: false });

		expect(parentFocus.moveFocus).toHaveBeenCalledExactlyOnceWith(1, 'end', { append: false });
	});

	it('collapsed chrome-row and upward targets stay on the inner dispatch', async () => {
		const moveWithin = vi.fn();
		const parentFocus = stubParentFocus();
		const gated = gateMoveFocusOnCollapse(
			() => true,
			moveWithin,
			parentFocus,
			() => 3
		);

		await gated(0, 'start');
		await gated(-1, 'end');

		expect(moveWithin).toHaveBeenCalledTimes(2);
		expect(parentFocus.moveFocus).not.toHaveBeenCalled();
	});

	it('expanded: body targets stay on the inner dispatch', async () => {
		const moveWithin = vi.fn();
		const parentFocus = stubParentFocus();
		const gated = gateMoveFocusOnCollapse(
			() => false,
			moveWithin,
			parentFocus,
			() => 3
		);

		await gated(1, 'start');

		expect(moveWithin).toHaveBeenCalledExactlyOnceWith(1, 'start', undefined);
		expect(parentFocus.moveFocus).not.toHaveBeenCalled();
	});

	it('no isCollapsed getter: transparent passthrough (callout parity)', async () => {
		const moveWithin = vi.fn();
		const parentFocus = stubParentFocus();
		const gated = gateMoveFocusOnCollapse(undefined, moveWithin, parentFocus, () => 3);

		await gated(2, 'start');

		expect(moveWithin).toHaveBeenCalledExactlyOnceWith(2, 'start', undefined);
		expect(parentFocus.moveFocus).not.toHaveBeenCalled();
	});
});
