/**
 * Did a promise settle inside a fixed number of microtasks? Racing that budget rather than
 * awaiting is what lets a termination test report a hang instead of stalling the suite on it, and
 * it drains microtasks only, with no wall-clock timer (Design Rule 2, G4.4).
 */
export async function settlesWithin(p: Promise<unknown>, turns = 50): Promise<boolean> {
	let settled = false;
	void p.then(() => {
		settled = true;
	});
	for (let i = 0; i < turns && !settled; i++) await Promise.resolve();
	return settled;
}
