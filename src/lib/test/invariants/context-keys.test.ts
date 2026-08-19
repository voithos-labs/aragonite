import { describe, it, expect } from 'vitest';
import { checkNoContainerHistoryKey } from '../../invariants/context-keys';

const HISTORY_KEY = Symbol('history-actions');
const FOCUS_KEY = Symbol('focus');
const BLOCK_EDIT_KEY = Symbol('block-edit');

describe('checkNoContainerHistoryKey (G1.4)', () => {
	it('fires when the key set includes HISTORY_KEY', () => {
		const violation = checkNoContainerHistoryKey([FOCUS_KEY, HISTORY_KEY], HISTORY_KEY);
		expect(violation?.code).toBe('container-sets-history-key');
	});

	it('passes for a set without HISTORY_KEY', () => {
		expect(checkNoContainerHistoryKey([FOCUS_KEY, BLOCK_EDIT_KEY], HISTORY_KEY)).toBeNull();
	});
});
