// Miss-analysis (GH #31): no test finished an undo while the paste's caret placement waited.
import { describe, it, expect, vi } from 'vitest';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import type { UndoController } from '$lib/editor-actions/deps';
import type { BlockComponent } from '$lib/block-component';

/** Only the two members the caret placement reads; the rest of the controller never runs here. */
function stubController(): UndoController {
	let generation = 0;
	return {
		historyGeneration: () => generation,
		noteHistorySwap: () => {
			generation++;
		}
	} as unknown as UndoController;
}

function coordinatorWith(duringReveal?: (controller: UndoController) => void) {
	const controller = stubController();
	const focus = vi.fn();
	const revealPath = vi.fn(async () => {
		duringReveal?.(controller);
		return { focus } as unknown as BlockComponent;
	});
	return { focus, coordinator: createPasteCoordinator(controller, revealPath) };
}

describe('paste landing vs an in-flight history swap', () => {
	it('declines to place the caret when a swap resolved inside the reveal', async () => {
		const { focus, coordinator } = coordinatorWith((c) => c.noteHistorySwap());

		await coordinator.landCaret([2], 3);

		expect(focus).not.toHaveBeenCalled();
	});

	it('places the caret when the stack did not move', async () => {
		const { focus, coordinator } = coordinatorWith();

		await coordinator.landCaret([2], 3);

		expect(focus).toHaveBeenCalledWith(3);
	});
});
