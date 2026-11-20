/**
 * Microtask budgets, drained with no wall-clock timer (`docs/contributing/rules.md` § Sequencing):
 * whether a promise settles inside one, which lets a termination test report a hang instead of
 * stalling the suite on it, and the checkpoint a browser drains before it sends its next event.
 */
export async function settlesWithin(p: Promise<unknown>, turns = 50): Promise<boolean> {
	let settled = false;
	void p.then(() => {
		settled = true;
	});
	for (let i = 0; i < turns && !settled; i++) await Promise.resolve();
	return settled;
}

/** Far more turns than the longest chain of ticks the editor awaits inside a listener. */
export const MICROTASK_CHECKPOINT_TURNS = 1000;

/** The browser's checkpoint: every microtask a listener queued runs before the next event. */
export async function microtaskCheckpoint(): Promise<void> {
	for (let i = 0; i < MICROTASK_CHECKPOINT_TURNS; i++) await Promise.resolve();
}
