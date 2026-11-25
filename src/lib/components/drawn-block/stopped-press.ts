/**
 * The dev check behind G1.252: every press that starts inside a drawing passes back up through the
 * drawing's element, unless the drawing stopped it. Checked as the press ends, since a stopped event
 * never reaches a later listener.
 */
import { on } from 'svelte/events';
import { assertInvariant } from '@voithos-labs/aragonite/dev-checks';
import { checkPressReachedEditor } from '../../invariants/drawing-press';

/** Watches the presses inside `el`, the drawing's element; returns the removers. */
export function watchStoppedPresses(el: HTMLElement, kind: () => string): (() => void)[] {
	const pending = new Set<Event>();
	const ended = () => {
		const stopped = [...pending].map((e) => e.type);
		pending.clear();
		assertInvariant('press-reaches-editor', () => checkPressReachedEditor(stopped, kind()));
	};
	return [
		...['pointerdown', 'mousedown'].flatMap((type) => [
			on(el, type, (e) => pending.add(e), { capture: true }),
			on(el, type, (e) => pending.delete(e))
		]),
		...['pointerup', 'pointercancel', 'mouseup'].map((type) =>
			on(document, type, ended, { capture: true })
		)
	];
}
