/**
 * The walk behind every "widen the opener past its own body" rule: raise `minimum` one past
 * each body line that would close the block at the width reached so far. A core leaf because
 * the fence grammar and the directive grammar both need it, and neither should import the
 * other's directory. Per-syntax knowledge stays in `closerRun`, which reports the closing
 * line's run length or `null` for a line that does not close.
 */
export function escalateTerminatorRun(
	body: string,
	minimum: number,
	closerRun: (text: string, required: number) => number | null
): number {
	let required = minimum;
	for (const line of body.split('\n')) {
		// Splitting on `\n` leaves a CRLF body's `\r` on the tail; a closer line's text excludes it.
		const text = line.endsWith('\r') ? line.slice(0, -1) : line;
		const run = closerRun(text, required);
		if (run !== null) required = run + 1;
	}
	return required;
}
