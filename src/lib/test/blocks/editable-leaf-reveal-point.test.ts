// @vitest-environment jsdom
//
// Miss-analysis: every render-primary case drove the reveal through `parkCaret`, which is handed
// an offset, so nothing exercised the one entry that has to work one out, and the hardcoded 0
// click handler passed was never read back; and no fixture ever spread `renderProps` anywhere the
// fold kept, so both handlers re-firing on the way up from the revealed source went unseen. The
// pointer-down alone then stood in for a click, so moving it to the release went unseen too.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { unmount } from 'svelte';
import type { BlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { resetPluginPlatformForTests } from '$lib/testing';
import { installLayoutStubs } from '$lib/test/harness/mount-editor.svelte';
import { settleEditor } from '$lib/test/harness/settle';
import { leafDocument, mountRevealLeaf, registerRevealLeafKind } from './fixtures/reveal-leaf';

const KIND = 'reveal-point-leaf';
const RAW = '@@ one two\n';

function mountLeaf(caretTargetAtPoint?: BlockKindDescriptor['caretTargetAtPoint']) {
	const kind = registerRevealLeafKind(KIND, { caretTargetAtPoint });
	// The `data-block-path` element BlockHost renders, because that, not the component's own
	// root, is what every caller of `caretTargetAtPoint` binds the hook to.
	const host = document.createElement('div');
	host.setAttribute('data-block-path', '[0]');
	document.body.appendChild(host);
	const history = { requestUndo: vi.fn(), requestRedo: vi.fn() };
	const mounted = mountRevealLeaf(leafDocument(kind, RAW), {
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
	resetPluginPlatformForTests();
	installLayoutStubs();
});

afterEach(async () => {
	if (mounted) await unmount(mounted.instance);
	mounted = null;
	document.body.innerHTML = '';
	resetPluginPlatformForTests();
});

describe('a reveal click on a render-primary leaf', () => {
	it('lands the caret where the kind’s caretTargetAtPoint names', async () => {
		mounted = mountLeaf(() => ({ path: [], offset: 6 }));

		await mounted.clickRendered(40, 12);

		expect(mounted.instance.getCursorOffset()).toBe(6);
	});

	it('hands the hook the block host and the pressed point', async () => {
		const hook = vi.fn(() => ({ path: [], offset: 3 }));
		mounted = mountLeaf(hook);

		await mounted.clickRendered(40, 12);

		expect(hook).toHaveBeenCalledWith(mounted.host, 40, 12);
	});

	it('reveals at the source start for a kind declaring no hook', async () => {
		mounted = mountLeaf();

		await mounted.clickRendered(40, 12);

		expect(mounted.instance.getCursorOffset()).toBe(0);
	});

	it('reveals at the source start when the hook declines the point', async () => {
		mounted = mountLeaf(() => null);

		await mounted.clickRendered(40, 12);

		expect(mounted.instance.getCursorOffset()).toBe(0);
	});
});

describe('the folded surface’s spread while the source is up', () => {
	it('leaves a press inside the source to the source', async () => {
		const hook = vi.fn(() => ({ path: [], offset: 3 }));
		mounted = mountLeaf(hook);
		const source = await mounted.revealAtEnd();

		source.dispatchEvent(
			new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 40, clientY: 12 })
		);
		await settleEditor();

		expect(hook).not.toHaveBeenCalled();
	});

	it('spends a chord from the source once, not twice on the way up', async () => {
		mounted = mountLeaf();
		const source = await mounted.revealAtEnd();

		source.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })
		);
		await settleEditor();

		expect(mounted.history.requestUndo).toHaveBeenCalledTimes(1);
	});
});
