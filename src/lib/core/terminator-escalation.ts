/**
 * The run length a fence or directive opener needs so no body line closes it: `minimum`, raised
 * one past each body line that would close the block at the width reached so far. `closerRun`
 * reports a closing line's run length, or `null` for a line that does not close.
 */
import { displayLines } from './lines';

export function escalateTerminatorRun(
	body: string,
	minimum: number,
	closerRun: (text: string, required: number) => number | null
): number {
	let required = minimum;
	for (const { text } of displayLines(body)) {
		const run = closerRun(text, required);
		if (run !== null) required = run + 1;
	}
	return required;
}
