import { describe, it, expect } from 'vitest';
import {
	clampWidth,
	keyboardResizeWidth,
	snapWidth,
	resolveAspectLockedHeight,
	KEYBOARD_MIN_WIDTH,
	MIN_WIDTH
} from '../../components/image/image-resize';

describe('clampWidth', () => {
	it('clamps below floor to MIN_WIDTH', () => {
		expect(clampWidth(5, 1000)).toBe(MIN_WIDTH);
	});
	it('clamps above ceiling to maxWidth', () => {
		expect(clampWidth(5000, 1000)).toBe(1000);
	});
	it('passes through valid values', () => {
		expect(clampWidth(500, 1000)).toBe(500);
	});
	it('rounds non-integer input', () => {
		expect(clampWidth(123.7, 1000)).toBe(124);
	});
});

describe('keyboardResizeWidth', () => {
	const max = 800;
	it('caps growth at the editor content width', () => {
		expect(keyboardResizeWidth(790, 20, max)).toBe(max);
	});
	it('does not exceed the ceiling on a value already at it', () => {
		expect(keyboardResizeWidth(800, 20, max)).toBe(max);
	});
	it('holds at the keyboard floor when shrinking past it', () => {
		expect(keyboardResizeWidth(40, -20, max)).toBe(KEYBOARD_MIN_WIDTH);
		expect(keyboardResizeWidth(KEYBOARD_MIN_WIDTH, -20, max)).toBe(KEYBOARD_MIN_WIDTH);
	});
	it('passes through a nudge that stays within bounds', () => {
		expect(keyboardResizeWidth(400, 20, max)).toBe(420);
	});
});

describe('snapWidth', () => {
	const max = 800;
	it('snaps near 25% to 200', () => {
		expect(snapWidth(195, max, 20)).toBe(200);
	});
	it('snaps near 50% to 400', () => {
		expect(snapWidth(390, max, 20)).toBe(400);
	});
	it('does not snap when outside threshold', () => {
		expect(snapWidth(300, max, 20)).toBe(300);
	});
	it('snaps near 100% to max', () => {
		expect(snapWidth(795, max, 20)).toBe(800);
	});
	it('rounds the input before checking snap', () => {
		expect(snapWidth(199.7, max, 20)).toBe(200);
	});
});

describe('resolveAspectLockedHeight', () => {
	it('preserves aspect ratio', () => {
		expect(resolveAspectLockedHeight(400, 800, 600)).toBe(300);
	});
	it('rounds to integer', () => {
		expect(resolveAspectLockedHeight(401, 800, 600)).toBe(301);
	});
	it('returns undefined when naturalWidth is 0 (not-yet-loaded image, avoids |Nx0)', () => {
		expect(resolveAspectLockedHeight(400, 0, 600)).toBeUndefined();
	});
});
