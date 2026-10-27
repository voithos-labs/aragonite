// @vitest-environment jsdom
// A click on a render-primary leaf's rendered half, over both forms of the leaf.
// Miss-analysis: reveals came only through `parkCaret`, and no fixture spread `renderProps`.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { unmount } from 'svelte';
import type { BlockKindDescriptor } from '#lib/schema/block-kind-descriptor.js';
import { installLayoutStubs } from '#lib/test/harness/mount-editor.svelte.js';
import { settleEditor } from '#lib/test/harness/settle.js';
import {
	REVEAL_LEAF_FORMS,
	leafDocument,
	mountRevealLeaf,
	registerRevealLeafKind,
	type RevealLeafForm
} from '../fixtures/reveal-leaf';

const KIND = 'reveal-point-leaf';
const RAW = '@@ one two\n';

function mountLeaf(
	form: RevealLeafForm,
	caretTargetAtPoint?: BlockKindDescriptor['caretTargetAtPoint']
) {
	const kind = registerRevealLeafKind(KIND, { caretTargetAtPoint });
	// Every caller of `caretTargetAtPoint` binds the hook to BlockHost's `data-block-path`
	// element, not the component's own root.
	const host = document.createElement('div');
	host.setAttribute('data-block-path', '[0]');
	document.body.appendChild(host);
	const history = { requestUndo: vi.fn(), requestRedo: vi.fn() };
	const mounted = mountRevealLeaf(leafDocument(kind, RAW), {
		form,
		target: host,
		overrides: {
			history,
			doc: { blockElLookup: () => host.firstElementChild as HTMLElement }
		}
	});

	return {
		...mounted,
		host,
		history,
		/** Click the rendered view at a viewport point, then wait for the source it opens. Both
		 *  pointer-down and click fire, as a real click does, and the click is what opens it. */
		clickRendered: async (clientX: number, clientY: number) => {
			const rendered = host.querySelector<HTMLElement>('.reveal-leaf-render');
			expect(rendered, 'the leaf mounted no rendered view').not.toBeNull();
			rendered!.dispatchEvent(
				new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX, clientY })
			);
			rendered!.dispatchEvent(
				new MouseEvent('click', { bubbles: true, cancelable: true, clientX, clientY })
			);
			await settleEditor();
		}
	};
}

let mounted: ReturnType<typeof mountLeaf> | null = null;

beforeEach(() => {
	installLayoutStubs();
});

afterEach(async () => {
	if (mounted) await unmount(mounted.instance);
	mounted = null;
	document.body.innerHTML = '';
});

describe.each(REVEAL_LEAF_FORMS)('a reveal click on a render-primary leaf drawn by %s', (form) => {
	it('lands the caret where the kind’s caretTargetAtPoint names', async () => {
		mounted = mountLeaf(form, () => ({ path: [], offset: 6 }));

		await mounted.clickRendered(40, 12);

		expect(mounted.blockApi.getCursorOffset()).toBe(6);
	});

	it('hands the hook the block host and the pressed point', async () => {
		const hook = vi.fn(() => ({ path: [], offset: 3 }));
		mounted = mountLeaf(form, hook);

		await mounted.clickRendered(40, 12);

		expect(hook).toHaveBeenCalledWith(mounted.host, 40, 12);
	});

	it('reveals at the source start for a kind declaring no hook', async () => {
		mounted = mountLeaf(form);

		await mounted.clickRendered(40, 12);

		expect(mounted.blockApi.getCursorOffset()).toBe(0);
	});

	it('reveals at the source start when the hook declines the point', async () => {
		mounted = mountLeaf(form, () => null);

		await mounted.clickRendered(40, 12);

		expect(mounted.blockApi.getCursorOffset()).toBe(0);
	});
});

describe.each(REVEAL_LEAF_FORMS)('the rendered half’s handlers on %s', (form) => {
	it('leaves a press inside the source to the source', async () => {
		const hook = vi.fn(() => ({ path: [], offset: 3 }));
		mounted = mountLeaf(form, hook);
		const source = await mounted.revealAtEnd();

		source.dispatchEvent(
			new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 40, clientY: 12 })
		);
		await settleEditor();

		expect(hook).not.toHaveBeenCalled();
	});

	it('spends a chord pressed on the folded view once, at this block', async () => {
		mounted = mountLeaf(form);
		const rendered = mounted.host.querySelector<HTMLElement>('.reveal-leaf-render')!;

		rendered.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })
		);
		await settleEditor();

		expect(mounted.history.requestUndo).toHaveBeenCalledTimes(1);
	});

	it('spends a chord from the source once, not twice on the way up', async () => {
		mounted = mountLeaf(form);
		const source = await mounted.revealAtEnd();

		source.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })
		);
		await settleEditor();

		expect(mounted.history.requestUndo).toHaveBeenCalledTimes(1);
	});
});
