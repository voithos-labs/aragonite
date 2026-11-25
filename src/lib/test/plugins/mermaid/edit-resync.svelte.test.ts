// @vitest-environment jsdom
// The open edit box against a document that changes underneath it: a write to its block from
// elsewhere (a host's write, an undo) makes its draft stale, which must reach the textarea, or the
// blur commit writes text based on bytes the document has since dropped.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { headless } from '#lib/testing.js';
import { mermaid } from '#packages/mermaid/src/index.js';
import {
	destroyMountedEditors,
	mountEditor,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';

const CODE = 'graph TD\n\tA --> B\n';
const SOURCE = `intro\n\n\`\`\`mermaid\n${CODE}\`\`\`\n\noutro\n`;

let mounted: MountedEditor | null = null;

// No renderer supplied: the block falls back to showing its code, so mermaid never loads and
// every edit-mode path below is still the shipped one.
function mountMermaid(): HTMLElement {
	mounted = mountEditor({ source: SOURCE, plugins: [mermaid], scrollMode: 'host' });
	return mounted.target;
}

function textarea(): HTMLTextAreaElement {
	const el = mounted?.target.querySelector<HTMLTextAreaElement>('[data-testid="mermaid-source"]');
	if (!el) throw new Error('the mermaid edit textarea is not mounted');
	return el;
}

function openEdit(root: HTMLElement): void {
	root.querySelector<HTMLButtonElement>('[data-testid="mermaid-edit"]')!.click();
	flushSync();
}

/** A host's rewrite of the diagram's code, while the box is open. */
async function rewriteCodeExternally(code: string): Promise<void> {
	const from = mounted!.instance.getSource().indexOf(CODE);
	const draft = mounted!.instance.edit().replace({ from, to: from + CODE.length }, code);
	expect(await draft.commit()).toEqual({ ok: true });
	flushSync();
}

beforeEach(() => {
	headless();
});

afterEach(async () => {
	await destroyMountedEditors();
	mounted = null;
});

function typeDraft(text: string): void {
	const el = textarea();
	el.value = text;
	el.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

function blurEditBox(): void {
	textarea().dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
	flushSync();
}

describe('an external code change under an open mermaid edit box', () => {
	it('re-seeds the textarea from the document', async () => {
		const root = mountMermaid();
		openEdit(root);
		expect(textarea().value).toBe('graph TD\n\tA --> B');

		await rewriteCodeExternally('graph LR\n\tX --> Y\n');

		expect(textarea().value).toBe('graph LR\n\tX --> Y');
	});

	it('discards a pre-change draft rather than committing it back over the change', async () => {
		const root = mountMermaid();
		openEdit(root);
		typeDraft('graph TD\n\tA --> C');
		await rewriteCodeExternally('graph LR\n\tX --> Y\n');

		blurEditBox();

		expect(mounted!.instance.getSource()).toContain('graph LR\n\tX --> Y');
		expect(mounted!.instance.getSource()).not.toContain('A --> C');
	});

	// Miss-analysis: every row changed the diagram's code, so a write to the fence alone, which 0.11.5
	// also re-seeded on, had no row.
	it('discards a pre-change draft when a write changes only its fence', async () => {
		const root = mountMermaid();
		openEdit(root);
		typeDraft('graph TD\n\tA --> C');
		const opener = mounted!.instance.getSource().indexOf('```mermaid');
		const closer = opener + '```mermaid\n'.length + CODE.length;
		const fence = mounted!.instance
			.edit()
			.replace({ from: opener, to: opener + 3 }, '~~~')
			.replace({ from: closer, to: closer + 3 }, '~~~');
		expect(await fence.commit()).toEqual({ ok: true });
		flushSync();

		blurEditBox();
		await mounted!.settle();

		expect(mounted!.instance.getSource()).toBe(SOURCE.replaceAll('```', '~~~'));
	});

	it('writes nothing once another document replaces the one it opened on', async () => {
		const root = mountMermaid();
		openEdit(root);
		typeDraft('graph TD\n\tA --> C');
		mounted!.props.source = 'Other doc\n';
		await mounted!.settle();

		expect(mounted!.instance.getSource()).toBe('Other doc\n');
		expect(mounted!.instance.canRunCommand('history.undo')).toBe(false);
	});

	// Miss-analysis: every row kept the box open across the change, so a box an undo reopened on
	// the bytes it was last seeded from, still holding the text typed before it closed, had no row.
	it('reopens on the body as written when an undo empties the diagram again', async () => {
		mounted = mountEditor({
			source: 'intro\n\n```mermaid\n```\n',
			plugins: [mermaid],
			scrollMode: 'host'
		});
		typeDraft('graph TD');
		textarea().dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })
		);
		await mounted.settle();
		expect(mounted.instance.getSource()).toBe('intro\n\n```mermaid\ngraph TD\n```\n');

		mounted.instance.runCommand('history.undo');
		await mounted.settle();

		expect(textarea().value).toBe('');
		blurEditBox();
		await mounted.settle();
		expect(mounted.instance.getSource()).toBe('intro\n\n```mermaid\n```\n');
	});

	// Non-vacuity: the re-seed must fire on an external change only, never on ordinary typing.
	it('still commits a draft that nothing changed underneath', () => {
		const root = mountMermaid();
		openEdit(root);
		typeDraft('graph TD\n\tA --> C');

		blurEditBox();

		expect(mounted!.instance.getSource()).toContain('graph TD\n\tA --> C');
	});
});
