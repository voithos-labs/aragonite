// @vitest-environment jsdom
//
// Miss-analysis: every render-primary case drove the reveal through `parkCaret`, which is handed
// an offset, so nothing exercised the one entry that has to COMPUTE one and the hardcoded 0 the
// click handler passed was never read back.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RevealLeafBlock from './fixtures/RevealLeafBlock.svelte';
import { declarePluginKind, registerBlockKind, simpleLeafClosure } from '$lib/plugin';
import type { BlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { resetPluginPlatformForTests } from '$lib/testing';
import type { CstNode, Document } from '$lib/core/nodes';
import { makeStubBlockEdit } from '../harness/editor-actions';
import { editorMountContext } from '../harness/mount-context';
import { installLayoutStubs } from './editor-mount';

const KIND = 'reveal-point-leaf';
const RAW = '@@ one two\n';

/** Drains the microtask queue the reveal runs on. */
const flush = () => new Promise((resolve) => setTimeout(resolve));

function mountLeaf(caretTargetAtPoint?: BlockKindDescriptor['caretTargetAtPoint']) {
	const kind = declarePluginKind(KIND);
	registerBlockKind(kind, {
		gapEdges: 'none',
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		caretTargetAtPoint,
		closure: simpleLeafClosure({
			focus: { mode: 'implemented', via: 'createEditableLeaf render-primary reveal' },
			searchPaint: { mode: 'inherit-default' },
			undo: { mode: 'implemented', via: 'render-primary: one commit when the caret leaves' },
			simOracle: { mode: 'inherit-default' }
		})
	});

	const node: CstNode = { kind, leadingTrivia: '', raw: RAW } as CstNode;
	const doc: Document = { kind: 'document', prefix: '', children: [node], suffix: '' };
	// The `data-block-path` host BlockHost renders, because that — not the component's own
	// root — is the element every `caretTargetAtPoint` consumer binds the hook to.
	const host = document.createElement('div');
	host.setAttribute('data-block-path', '[0]');
	document.body.appendChild(host);

	const instance = mount(RevealLeafBlock, {
		target: host,
		props: { node, index: 0, myPath: [0] },
		context: editorMountContext({
			blockEdit: makeStubBlockEdit(),
			doc: { doc: () => doc, blockElLookup: () => host.firstElementChild as HTMLElement }
		})
	});
	flushSync();

	return {
		instance,
		host,
		/** Press on the folded view at a viewport point, then settle the reveal it opens. */
		clickRendered: async (clientX: number, clientY: number) => {
			const rendered = host.querySelector<HTMLElement>('.reveal-leaf-render');
			expect(rendered, 'the leaf mounted no rendered view').not.toBeNull();
			rendered!.dispatchEvent(
				new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX, clientY })
			);
			await flush();
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
