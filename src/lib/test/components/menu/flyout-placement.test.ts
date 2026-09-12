// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { keepFlyoutOnScreen } from '$lib/components/menu/flyout-placement';

// The attachment writes the viewport correction inline over the CSS that hangs a flyout off its
// row's right edge: lifted by the overflow at the bottom, flipped to the left at the right edge
// when the parent menu leaves room there, untouched where it fits.

function rect(r: Partial<DOMRect>): DOMRect {
	return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, ...r } as DOMRect;
}

function viewport(width: number, height: number): void {
	Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
	Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
}

function mountFlyout(menu: Partial<DOMRect>, flyout: Partial<DOMRect>): HTMLElement {
	const menuEl = document.createElement('div');
	menuEl.className = 'md-menu';
	const row = document.createElement('div');
	const flyoutEl = document.createElement('div');
	row.append(flyoutEl);
	menuEl.append(row);
	document.body.append(menuEl);
	menuEl.getBoundingClientRect = () => rect(menu);
	flyoutEl.getBoundingClientRect = () => rect(flyout);
	return flyoutEl;
}

const FITS = { top: 100, bottom: 300, right: 400, width: 180 };

describe('keepFlyoutOnScreen', () => {
	beforeEach(() => {
		document.body.replaceChildren();
		viewport(1000, 600);
	});

	it('leaves a flyout that fits where its CSS hung it', () => {
		const flyout = mountFlyout({ left: 200 }, FITS);
		keepFlyoutOnScreen(flyout);
		expect(flyout.getAttribute('style')).toBeNull();
	});

	it('lifts a flyout that runs past the bottom edge by its overflow', () => {
		const flyout = mountFlyout({ left: 200 }, { ...FITS, top: 500, bottom: 700 });
		keepFlyoutOnScreen(flyout);
		// 700 + 8 margin - 600 viewport; jsdom's offsetTop is 0, so the lift is the whole value.
		expect(flyout.style.top).toBe('-108px');
	});

	it('lifts no further than the top margin', () => {
		const flyout = mountFlyout({ left: 200 }, { ...FITS, top: 50, bottom: 700 });
		keepFlyoutOnScreen(flyout);
		expect(flyout.style.top).toBe('-42px');
	});

	it('flips to the left of the row past the right edge, when the menu leaves room there', () => {
		const flyout = mountFlyout({ left: 500 }, { ...FITS, right: 1100 });
		keepFlyoutOnScreen(flyout);
		expect(flyout.style.left).toBe('auto');
		expect(flyout.style.right).toBe('100%');
		expect(flyout.style.marginLeft).toBe('0px');
		expect(flyout.style.marginRight).toBe('4px');
	});

	it('stays on the right when the left has no room either', () => {
		const flyout = mountFlyout({ left: 100 }, { ...FITS, right: 1100 });
		keepFlyoutOnScreen(flyout);
		expect(flyout.style.right).toBe('');
	});

	it('does nothing for a flyout with no menu above it', () => {
		const orphan = document.createElement('div');
		document.body.append(orphan);
		keepFlyoutOnScreen(orphan);
		expect(orphan.getAttribute('style')).toBeNull();
	});
});
