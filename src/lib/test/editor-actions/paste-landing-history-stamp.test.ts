// Miss-analysis (GH #31): no test finished an undo while the paste's caret placement waited.
import { describe, it, expect, vi } from 'vitest';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import type { EditorActionsDeps, UndoController } from '$lib/editor-actions/deps';
import type { BlockComponent } from '$lib/block-component';
import type { CaretLanding } from '$lib/selection/caret-landing';

/** Only the tree-swap counter's two members; the rest of the landing never runs here. */
function stubLanding(): CaretLanding {
	let generation = 0;
	return {
		generation: () => generation,
		noteTreeSwap: () => {
			generation++;
		}
	} as unknown as CaretLanding;
}

function coordinatorWith(duringReveal?: (landing: CaretLanding) => void) {
	const caretLanding = stubLanding();
	const focus = vi.fn();
	const revealPath = vi.fn(async () => {
		duringReveal?.(caretLanding);
		return { focus } as unknown as BlockComponent;
	});
	const deps = { revealPath, caretLanding } as unknown as EditorActionsDeps;
	return { focus, coordinator: createPasteCoordinator(deps, {} as UndoController) };
}

describe('paste landing vs an in-flight history swap', () => {
	it('declines to place the caret when a swap resolved inside the reveal', async () => {
		const { focus, coordinator } = coordinatorWith((landing) => landing.noteTreeSwap());

		await coordinator.landCaret([2], 3);

		expect(focus).not.toHaveBeenCalled();
	});

	it('places the caret when the stack did not move', async () => {
		const { focus, coordinator } = coordinatorWith();

		await coordinator.landCaret([2], 3);

		expect(focus).toHaveBeenCalledWith(3);
	});
});
