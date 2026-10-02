import type { InvariantViolation } from '../assert';

/** G1.4: a container may not provide `HISTORY_KEY` to its descendants: history reaches nested
 *  action contexts from the root, and shadowing the key would split the undo stack. */
export function checkNoContainerHistoryKey(
	setKeys: symbol[],
	historyKey: symbol
): InvariantViolation | null {
	if (setKeys.includes(historyKey)) {
		return {
			code: 'container-sets-history-key',
			message: 'container provides HISTORY_KEY to descendants: undo stack would split'
		};
	}
	return null;
}
