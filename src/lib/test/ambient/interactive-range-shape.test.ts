/**
 * Type pins for the marker range shape: a range with a tab stop must carry the handler Enter and
 * Space run. The `@ts-expect-error` directive is the assertion; `npm run check` fails the day a
 * focusable range without `onActivate` starts compiling.
 */
import { describe, it, expect } from 'vitest';
import type { AmbientInteractiveRange } from '$lib/block-component';

const base = { start: 0, end: 3, className: 'marker', onClick: () => {} };

export function focusableWithoutActivateRejected(): AmbientInteractiveRange {
	// @ts-expect-error a focusable range must say what Enter and Space do
	return { ...base, focusable: true };
}

// The footnote marker's form: its stop is decided by mode, so `focusable` is a plain boolean.
function modeDecidedStop(isReading: boolean): AmbientInteractiveRange {
	return { ...base, focusable: isReading, onActivate: () => {} };
}

describe('AmbientInteractiveRange', () => {
	it('accepts a mode-decided tab stop that carries its handler', () => {
		expect(modeDecidedStop(true).focusable).toBe(true);
		expect(modeDecidedStop(false).focusable).toBe(false);
	});

	it('accepts a range with no tab stop and no handler', () => {
		const range: AmbientInteractiveRange = { ...base };
		expect(range.focusable).toBeUndefined();
	});
});
