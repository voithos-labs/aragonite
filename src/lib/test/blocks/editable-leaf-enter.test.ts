// @vitest-environment jsdom
// Miss-analysis: every editable-leaf case used a multi-line kind, so none asked a one-line leaf.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { unmount } from 'svelte';
import { resetPluginPlatformForTests } from '$lib/testing';
import { installLayoutStubs } from '$lib/test/harness/mount-editor.svelte';
import { settleEditor, pressKey } from '$lib/test/harness/settle';
import { withStoredCaret } from '$lib/editor-actions/stored-caret';
import { leafDocument, mountRevealLeaf, registerRevealLeafKind } from './fixtures/reveal-leaf';

const KIND = 'enter-leaf';
const RAW = '@@ one\n';
const SOURCE = '@@ one';

function mountLeaf(singleLine: boolean) {
	const kind = registerRevealLeafKind(KIND);
	const mounted = mountRevealLeaf(leafDocument(kind, RAW), { props: { singleLine } });
	return {
		...mounted,
		source: () => mounted.target.querySelector<HTMLElement>('.reveal-leaf-source')
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

describe('Enter in an editable leaf', () => {
	it('stays inside a multi-line leaf as a literal newline', async () => {
		mounted = mountLeaf(false);
		const el = await mounted.revealAtEnd();

		await pressKey(el, { key: 'Enter' });

		expect(el.textContent).toBe(`${SOURCE}\n`);
		expect(mounted.blockEdit.splitBlock).not.toHaveBeenCalled();
	});

	it('splits a single-line leaf at the caret instead', async () => {
		mounted = mountLeaf(true);
		const el = await mounted.revealAtEnd();

		await pressKey(el, { key: 'Enter' });

		expect(mounted.blockEdit.splitBlock).toHaveBeenCalledWith(0, SOURCE.length);
		// The split first collapses the revealed source, so the block shows its rendered view.
		expect(mounted.source()).toBeNull();
	});

	// Miss-analysis: every case awaited the key on an untouched leaf, never one unmounted mid-step.
	it('drops the press whose container unmounted the leaf mid-step', async () => {
		mounted = mountLeaf(true);
		const el = await mounted.revealAtEnd();

		// Svelte's delegated dispatch does not await the handler, so the container above takes the
		// key and tears the block down while the leaf's Enter handling is still pending.
		el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		el.remove();
		await settleEditor();

		expect(mounted.blockEdit.splitBlock).not.toHaveBeenCalled();
	});

	it('lands the fold’s write before the split reads the block’s bytes', async () => {
		mounted = mountLeaf(true);
		let releaseWrite!: () => void;
		const writeGate = new Promise<void>((resolve) => {
			releaseWrite = resolve;
		});
		vi.mocked(mounted.blockEdit.updateBlockContent).mockImplementation(() =>
			withStoredCaret(writeGate, 0)
		);

		const el = await mounted.revealAtEnd();
		// A draft the reveal holds and the CST has not seen; the caret goes back to its end.
		el.textContent = '@@ two';
		mounted.instance.parkCaret(6);
		await settleEditor();
		await pressKey(el, { key: 'Enter' });

		expect(mounted.blockEdit.updateBlockContent).toHaveBeenCalledWith(
			0,
			'@@ two\n',
			'authored',
			6,
			6
		);
		expect(mounted.blockEdit.splitBlock).not.toHaveBeenCalled();

		releaseWrite();
		await settleEditor();
		expect(mounted.blockEdit.splitBlock).toHaveBeenCalledWith(0, 6);
	});
});
