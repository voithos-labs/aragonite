// @vitest-environment jsdom

// The open edit box against a document that changes underneath it: a write to the live CST
// from elsewhere (a host undo, a structural replace) must reach the textarea, or the blur
// commit writes text based on bytes that no longer exist.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import type { CstNode, Document } from '$lib';
import { setPluginMetadata } from '$lib/plugin';
import { installEditorDomStubsForTests, resetPluginPlatformForTests } from '$lib/testing';
import { mermaidPlugin } from '$lib/plugins/mermaid';
import { rebuildMermaidRaw, type MermaidMetadata } from '$lib/plugins/mermaid/mermaid-kind';
import {
	destroyMountedEditors,
	mountEditor,
	type MountedEditor
} from '$lib/test/harness/mount-editor.svelte';

const CODE = 'graph TD\n\tA --> B\n';
const SOURCE = `intro\n\n\`\`\`mermaid\n${CODE}\`\`\`\n\noutro\n`;

// Reaching the live node is the point here: reparsing `getSource()` gives a different tree the
// component never sees.
let mounted: MountedEditor<{ getDocument(): Document }> | null = null;

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

/** A code rewrite on the live tree from elsewhere: what an undo or a structural replace
 *  outside this component looks like from the block's side. */
function rewriteCodeExternally(code: string): void {
	const node = mounted!.instance.__test.getDocument().children[1] as unknown as CstNode;
	setPluginMetadata<MermaidMetadata>(node, {
		...(node.metadata as unknown as MermaidMetadata),
		code
	});
	rebuildMermaidRaw(node);
	flushSync();
}

beforeEach(() => {
	resetPluginPlatformForTests();
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
	it('re-seeds the textarea from the document', () => {
		const root = mountMermaid();
		openEdit(root);
		expect(textarea().value).toBe('graph TD\n\tA --> B');

		rewriteCodeExternally('graph LR\n\tX --> Y\n');

		expect(textarea().value).toBe('graph LR\n\tX --> Y');
	});

	it('discards a pre-change draft rather than committing it back over the change', () => {
		const root = mountMermaid();
		openEdit(root);
		typeDraft('graph TD\n\tA --> C');
		rewriteCodeExternally('graph LR\n\tX --> Y\n');

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
