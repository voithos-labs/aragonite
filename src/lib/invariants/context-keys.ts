import type { InvariantViolation } from '../assert';

/**
 * G1.4 — a container's provided context keys must not include the editor's
 * HISTORY_KEY. Containers re-provide nested action contexts to descendants but
 * must let history flow from the root; shadowing it would split the undo stack.
 */
export function checkNoContainerHistoryKey(
	setKeys: symbol[],
	historyKey: symbol
): InvariantViolation | null {
	if (setKeys.includes(historyKey)) {
		return {
			code: 'container-sets-history-key',
			message: 'container provides HISTORY_KEY to descendants — undo stack would split'
		};
	}
	return null;
}
