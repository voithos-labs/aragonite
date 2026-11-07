// @vitest-environment jsdom
// The open edit box against a document that changes underneath it: a write to its block from
// elsewhere (a host's write, an undo) makes its draft stale, which must reach the textarea, or the
// blur commit writes text based on bytes the document has since dropped.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { installEditorDomStubsForTests } from '#lib/testing.js';
import { mermaidPlugin } from '#packages/mermaid/src/index.js';
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
	mounted = mountEditor({ source: SOURCE, plugins: [mermaidPlugin()], scrollMode: 'host' });
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
	installEditorDomStubsForTests();
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

	// Non-vacuity: the re-seed must fire on an external change only, never on ordinary typing.
	it('still commits a draft that nothing changed underneath', () => {
		const root = mountMermaid();
		openEdit(root);
		typeDraft('graph TD\n\tA --> C');

		blurEditBox();

		expect(mounted!.instance.getSource()).toContain('graph TD\n\tA --> C');
	});
});
