import { checkReadingTabStops } from '../invariants/reading-tab-stops';

/**
 * For a block in reading mode, where Tab is the page's focus walk and the editor keeps one stop: null
 * when only controls and that stop are in the tab order, else the problem, naming each extra stop.
 * Mount with `presentationMode: 'reading'` and pass the editor's root (`.editor`), not your block.
 */
export function tabOrder(root: HTMLElement): string | null {
	return checkReadingTabStops(root)?.message ?? null;
}
