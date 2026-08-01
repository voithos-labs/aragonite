// @vitest-environment jsdom

// The open edit box against a document that changes underneath it: an out-of-band write
// to the live CST (a host history seam, a structural replace) must reach the textarea, or
// the blur commit writes a draft seeded from bytes that no longer exist.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { Editor } from '$lib';
import { installEditorDomStubsForTests, resetPluginPlatformForTests } from '$lib/testing';
import { mermaidPlugin } from '$lib/plugins/mermaid';
import { rebuildMermaidRaw, type MermaidMetadata } from '$lib/plugins/mermaid/mermaid-kind';
import { setPluginMetadata, type CstNode } from '$lib/core/nodes';

const CODE = 'graph TD\n\tA --> B\n';
const SOURCE = `intro\n\n\`\`\`mermaid\n${CODE}\`\`\`\n\noutro\n`;

// `__test` is off the published `EditorInstance`, and reaching the LIVE node is the
// point here — a reparse of `getSource()` is a different tree the component never sees.
type MountedEditor = ReturnType<typeof Editor>;

let instance: MountedEditor | null = null;
let target: HTMLElement | null = null;

// No renderer injected: the block falls to its static surface, so the diagram engine never
// loads and every edit-mode path below is still the shipped one.
function mountEditor(): HTMLElement {
	target = document.createElement('div');
	document.body.appendChild(target);
	instance = mount(Editor, {
		target,
		props: { source: SOURCE, plugins: [mermaidPlugin()], scrollMode: 'host' as const }
	}) as MountedEditor;
	flushSync();
	return target;
}

function textarea(): HTMLTextAreaElement {
	const el = target?.querySelector<HTMLTextAreaElement>('[data-testid="mermaid-source"]');
	if (!el) throw new Error('the mermaid edit textarea is not mounted');
	return el;
}

function openEdit(root: HTMLElement): void {
	root.querySelector<HTMLButtonElement>('[data-testid="mermaid-edit"]')!.click();
	flushSync();
}

/** An out-of-band code rewrite on the live tree — what an undo or a structural replace
 *  landing outside this component's gesture looks like from the block's side. */
function rewriteCodeExternally(code: string): void {
	const node = instance!.__test.getDocument().children[1] as unknown as CstNode;
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

afterEach(() => {
	if (instance) void unmount(instance);
	target?.remove();
	instance = null;
	target = null;
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
		const root = mountEditor();
		openEdit(root);
		expect(textarea().value).toBe('graph TD\n\tA --> B');

		rewriteCodeExternally('graph LR\n\tX --> Y\n');

		expect(textarea().value).toBe('graph LR\n\tX --> Y');
	});

	it('discards a pre-change draft rather than committing it back over the change', () => {
		const root = mountEditor();
		openEdit(root);
		typeDraft('graph TD\n\tA --> C');
		rewriteCodeExternally('graph LR\n\tX --> Y\n');

		blurEditBox();

		expect(instance!.getSource()).toContain('graph LR\n\tX --> Y');
		expect(instance!.getSource()).not.toContain('A --> C');
	});

	// Non-vacuity: the re-seed must fire on an external change only, never on ordinary typing.
	it('still commits a draft that nothing changed underneath', () => {
		const root = mountEditor();
		openEdit(root);
		typeDraft('graph TD\n\tA --> C');

		blurEditBox();

		expect(instance!.getSource()).toContain('graph TD\n\tA --> C');
	});
});
