import { escalatedColonCount } from './directive/grammar';
import { escalatedFenceLength } from './parsers/fence-syntax';

/** How many `marker`s a fence (`` ` `` or `~`) or a `:::` container around `body` needs: one past
 *  every body line that would close it, never fewer than `minimum`. */
export function escalatedRun(body: string, marker: '`' | '~' | ':', minimum: number): number {
	return marker === ':'
		? escalatedColonCount(body, minimum)
		: escalatedFenceLength(body, marker, minimum);
}
