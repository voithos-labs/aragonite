// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { consumePendingRestore } from '../../components/blocks/editable-surface';

// The blur-yank scar: a pending caret armed before a render must NOT be applied if
// focus left the block in the meantime, or the restore drags the global selection
// back into the just-blurred block. The three surfaces share this guard.
describe('consumePendingRestore', () => {
	let el: HTMLDivElement;
	let other: HTMLDivElement;

	beforeEach(() => {
		el = document.createElement('div');
		el.tabIndex = 0;
		other = document.createElement('div');
		other.tabIndex = 0;
		document.body.append(el, other);
	});

	afterEach(() => {
		el.remove();
		other.remove();
	});

	it('applies and reports true while the element still holds focus', () => {
		el.focus();
		let applied: number | null = null;
		const result = consumePendingRestore(el, 7, (offset) => {
			applied = offset;
		});
		expect(result).toBe(true);
		expect(applied).toBe(7);
	});

	it('does not apply and reports false when focus has left the element', () => {
		other.focus();
		let ran = false;
		const result = consumePendingRestore(el, 7, () => {
			ran = true;
		});
		expect(result).toBe(false);
		expect(ran).toBe(false);
	});

	it('is a no-op when there is no pending value', () => {
		el.focus();
		let ran = false;
		const result = consumePendingRestore(el, null, () => {
			ran = true;
		});
		expect(result).toBe(false);
		expect(ran).toBe(false);
	});

	it('reports false for a null element (unmounted surface)', () => {
		let ran = false;
		const result = consumePendingRestore(null, 3, () => {
			ran = true;
		});
		expect(result).toBe(false);
		expect(ran).toBe(false);
	});

	it('carries any pending shape — a range for the code wrap arm', () => {
		el.focus();
		let applied: { start: number; end: number } | null = null;
		const result = consumePendingRestore(el, { start: 2, end: 5 }, (range) => {
			applied = range;
		});
		expect(result).toBe(true);
		expect(applied).toEqual({ start: 2, end: 5 });
	});
});
