// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installReorderDrag } from '../../editor-actions/reorder-drag';

// installReorderDrag attaches ONE capture-phase pointerdown listener on the
// editor root; the per-drag document listeners only live for the duration of a
// drag (covered by the Escape/no-op e2e). This guards the root listener's
// lifecycle — the unmount-mid-session leak class e2e can't reach.
describe('installReorderDrag — root listener lifecycle', () => {
	let editorRoot: HTMLElement;
	let added: number;
	let removed: number;

	beforeEach(() => {
		editorRoot = document.createElement('div');
		document.body.appendChild(editorRoot);
		added = 0;
		removed = 0;
		const origAdd = editorRoot.addEventListener.bind(editorRoot);
		const origRemove = editorRoot.removeEventListener.bind(editorRoot);
		editorRoot.addEventListener = ((type: string, ...rest: unknown[]) => {
			if (type === 'pointerdown') added++;
			return origAdd(type, ...(rest as [EventListenerOrEventListenerObject]));
		}) as typeof editorRoot.addEventListener;
		editorRoot.removeEventListener = ((type: string, ...rest: unknown[]) => {
			if (type === 'pointerdown') removed++;
			return origRemove(type, ...(rest as [EventListenerOrEventListenerObject]));
		}) as typeof editorRoot.removeEventListener;
	});

	afterEach(() => editorRoot.remove());

	function makeCtx(signal?: AbortSignal) {
		return {
			editorRoot,
			moveReorderUnit: async () => {},
			overlay: { setGhost: () => {}, setLine: () => {} },
			lifetimeSignal: signal
		};
	}

	it('attaches the root pointerdown listener and removes it on dispose', () => {
		const handle = installReorderDrag(makeCtx());
		expect(added).toBe(1);
		expect(removed).toBe(0);
		handle.dispose();
		expect(removed).toBe(1);
	});

	it('aborting the lifetime signal removes the listener without an explicit dispose', () => {
		const controller = new AbortController();
		installReorderDrag(makeCtx(controller.signal));
		expect(added).toBe(1);
		controller.abort();
		expect(removed).toBe(1);
	});

	it('a pre-aborted signal nets no live listener', () => {
		const controller = new AbortController();
		controller.abort();
		installReorderDrag(makeCtx(controller.signal));
		expect(added - removed).toBe(0);
	});

	it('double dispose is idempotent (removes once, no throw)', () => {
		const handle = installReorderDrag(makeCtx());
		handle.dispose();
		expect(() => handle.dispose()).not.toThrow();
		expect(removed).toBe(1);
	});
});
