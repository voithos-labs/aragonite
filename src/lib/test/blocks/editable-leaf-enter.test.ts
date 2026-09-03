// @vitest-environment jsdom
//
// Miss-analysis: every editable-leaf case was written against a multi-line kind (block math, the
// `@@` harness leaf), so the literal newline Enter inserts was always visible and always wanted,
// and no test asked what a one-line leaf does with a byte it cannot show.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RevealLeafBlock from './fixtures/RevealLeafBlock.svelte';
import { declarePluginKind, registerBlockKind, simpleLeafClosure } from '$lib/plugin';
import { resetPluginPlatformForTests } from '$lib/testing';
import type { CstNode, Document } from '$lib/core/nodes';
import { makeStubBlockEdit } from '../harness/editor-actions';
import { editorMountContext } from '../harness/mount-context';
import { installLayoutStubs } from './editor-mount';

const KIND = 'enter-leaf';
const RAW = '@@ one\n';
const SOURCE = '@@ one';

/** Drains the microtask queue the async keydown handler and the reveal both run on. */
const flush = () => new Promise((resolve) => setTimeout(resolve));

function mountLeaf(singleLine: boolean) {
	const kind = declarePluginKind(KIND);
	registerBlockKind(kind, {
		gapEdges: 'none',
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		closure: simpleLeafClosure({
			focus: { mode: 'implemented', via: 'createEditableLeaf render-primary reveal' },
			searchPaint: { mode: 'inherit-default' },
			undo: { mode: 'implemented', via: 'render-primary: one commit when the caret leaves' },
			simOracle: { mode: 'inherit-default' }
		})
	});

	const node: CstNode = { kind, leadingTrivia: '', raw: RAW } as CstNode;
	const doc: Document = { kind: 'document', prefix: '', children: [node], suffix: '' };
	const blockEdit = makeStubBlockEdit();
	const target = document.createElement('div');
	document.body.appendChild(target);

	const instance = mount(RevealLeafBlock, {
		target,
		props: { node, index: 0, myPath: [0], singleLine },
		context: editorMountContext({ blockEdit, doc: { doc: () => doc } })
	});
	flushSync();

	return {
		instance,
		blockEdit,
		source: () => target.querySelector<HTMLElement>('.reveal-leaf-source'),
		/** Reveal the source with the caret at the end of the block's bytes. */
		revealAtEnd: async () => {
			instance.parkCaret(SOURCE.length);
			await flush();
			const el = target.querySelector<HTMLElement>('.reveal-leaf-source');
			expect(el, 'the reveal mounted no source element').not.toBeNull();
			return el!;
		}
	};
}

const pressEnter = async (el: HTMLElement) => {
	el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
	await flush();
};

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

		await pressEnter(el);

		expect(el.textContent).toBe(`${SOURCE}\n`);
		expect(mounted.blockEdit.splitBlock).not.toHaveBeenCalled();
	});

	it('splits a single-line leaf at the caret instead', async () => {
		mounted = mountLeaf(true);
		const el = await mounted.revealAtEnd();

		await pressEnter(el);

		expect(mounted.blockEdit.splitBlock).toHaveBeenCalledWith(0, SOURCE.length);
		// The fold is the split's precondition, so the source is back to its rendered view.
		expect(mounted.source()).toBeNull();
	});

	it('lands the fold’s write before the split reads the block’s bytes', async () => {
		mounted = mountLeaf(true);
		let releaseWrite!: () => void;
		const writeGate = new Promise<void>((resolve) => {
			releaseWrite = resolve;
		});
		vi.mocked(mounted.blockEdit.updateBlockContent).mockImplementation(() => writeGate);

		const el = await mounted.revealAtEnd();
		// A draft the reveal holds and the CST has not seen; the caret goes back to its end.
		el.textContent = '@@ two';
		mounted.instance.parkCaret(6);
		await flush();
		await pressEnter(el);

		expect(mounted.blockEdit.updateBlockContent).toHaveBeenCalledWith(0, '@@ two\n', 6, 6);
		expect(mounted.blockEdit.splitBlock).not.toHaveBeenCalled();

		releaseWrite();
		await flush();
		expect(mounted.blockEdit.splitBlock).toHaveBeenCalledWith(0, 6);
	});
});
