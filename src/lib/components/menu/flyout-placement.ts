/**
 * Svelte attachment for a menu flyout: measures the surface once it is in the DOM and moves it
 * to stay inside the viewport (`flyoutPlacement`). The element's own CSS hangs it off the row's
 * right edge; this writes the correction inline, so the rule lives in one place for every menu.
 */

import { flyoutPlacement } from '../blocks/table/table-menu-model';

const GAP = 4;

export function keepFlyoutOnScreen(node: HTMLElement): void {
	const parentMenu = node.parentElement?.closest<HTMLElement>('.md-menu');
	if (!parentMenu) return;
	const rect = node.getBoundingClientRect();
	const { dy, flip } = flyoutPlacement(
		rect,
		parentMenu.getBoundingClientRect(),
		{ width: window.innerWidth, height: window.innerHeight }
	);
	if (dy !== 0) node.style.top = `${node.offsetTop + dy}px`;
	if (flip) {
		node.style.left = 'auto';
		node.style.right = '100%';
		node.style.marginLeft = '0';
		node.style.marginRight = `${GAP}px`;
	}
}
