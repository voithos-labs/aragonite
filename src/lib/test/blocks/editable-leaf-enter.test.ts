// @vitest-environment jsdom
// Miss-analysis: every editable-leaf case used a multi-line kind, so none asked a one-line leaf.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { unmount } from 'svelte';
import { installLayoutStubs, selectRange } from '$lib/test/harness/mount-editor.svelte';
import { settleEditor, pressKey } from '$lib/test/harness/settle';
import { withStoredCaret } from '$lib/editor-actions/stored-caret';
import { leafDocument, mountRevealLeaf, registerRevealLeafKind } from './fixtures/reveal-leaf';
import PlainOneLineLeafBlock from './fixtures/PlainOneLineLeafBlock.svelte';
import { mountBlock } from '../harness/mount-block';

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
	installLayoutStubs();
});

afterEach(async () => {
	if (mounted) await unmount(mounted.instance);
	mounted = null;
	document.body.innerHTML = '';
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
		const writeGate = new Promise<boolean>((resolve) => {
			releaseWrite = () => resolve(true);
		});
		vi.mocked(mounted.blockEdit.updateBlockContent).mockImplementation(() =>
			withStoredCaret(writeGate, 0)
		);

		const el = await mounted.revealAtEnd();
		// A draft the reveal holds and the CST has not seen; the caret goes back to its end.
		el.textContent = '@@ two';
		mounted.instance.blockApi.parkCaret(6);
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

// Miss-analysis: every leaf Enter case pressed at a caret, so nothing saw the leaf break the line
// beside a selection it should have replaced.
describe('Enter over a selection in an editable leaf', () => {
	it('takes the selection out of a multi-line leaf, then breaks the line there', async () => {
		mounted = mountLeaf(false);
		const el = await mounted.revealAtEnd();
		selectRange(el, 4, 5);

		await pressKey(el, { key: 'Enter' });
		await settleEditor();

		expect(el.textContent).toBe('@@ o\ne');
	});

	it('takes the selection out of a one-line leaf, then splits there as a break', async () => {
		mounted = mountLeaf(true);
		const el = await mounted.revealAtEnd();
		selectRange(el, 4, 5);

		await pressKey(el, { key: 'Enter' });
		await settleEditor();

		expect(mounted.blockEdit.splitBlock).toHaveBeenCalledWith(0, 4, { afterRemoval: true });
	});
});

// A plain leaf's source stays focusable in reading mode, so its Enter arrives and the leaf's own
// reading-mode check is what keeps the split from asking the write.
describe('Enter in a plain one-line leaf in reading mode', () => {
	it('arrives, and splits nothing', async () => {
		const kind = registerRevealLeafKind(KIND);
		const plain = mountBlock(PlainOneLineLeafBlock, {
			doc: leafDocument(kind, RAW),
			overrides: { policies: { presentationMode: () => 'reading' } }
		});
		const el = plain.target.querySelector<HTMLElement>('.plain-one-line-source')!;
		el.focus();

		const pressed = await pressKey(el, { key: 'Enter' });

		expect(pressed.defaultPrevented).toBe(true);
		expect(plain.blockEdit.splitBlock).not.toHaveBeenCalled();
		await plain.dispose();
	});
});
