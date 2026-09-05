// @vitest-environment jsdom
// The container tier's `editable` declaration, end to end: a kind declares it, the factory
// threads it, the mounted surface reports it.
//
// Miss-analysis: the shim hardcoded `editable: true`, so no fixture could declare otherwise and
// every existing container test asserted the hardcode back — the capability had no kind to pin it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import {
	declarePluginKind,
	declaredPluginKind,
	registerBlockKind,
	registerBlockComponent,
	defineBlockComponent,
	containerClosure
} from '$lib/plugin';
import { installEditorDomStubsForTests, resetPluginPlatformForTests } from '$lib/testing';
import { isBlockEditable } from '$lib/schema/merge-rules';
import type { CstNode, Document } from '$lib/core/nodes';
import type { ContainerBlockComponent } from '$lib/block-component';
import { makeStubBlockEdit } from '../harness/editor-actions';
import { editorMountContext } from '../harness/mount-context';
import OpaqueContainerBlock from './fixtures/OpaqueContainerBlock.svelte';

const KIND = 'opaque-fixture-container';

function registerOpaqueKind(): void {
	const kind = declarePluginKind(KIND);
	registerBlockKind(kind, {
		gapEdges: 'none',
		mergeRole: 'not-mergeable',
		// The declaration under test: a surface whose only edit path would be its own UI.
		editable: false,
		supportsInline: false,
		blockFocus: 'whole-block',
		container: { contract: 'opaque', rebuildRaw: (node) => node.raw },
		closure: containerClosure({
			roundTripVia: 'opaque — raw is authoritative, rebuilt verbatim',
			focus: { mode: 'implemented', via: 'blockFocus=whole-block via the container shim' },
			mergeBackspace: { mode: 'implemented', via: 'blockFocus=whole-block focus-then-delete' },
			undo: { mode: 'not-supported', reason: 'the fixture commits no bytes of its own' },
			simOracle: { mode: 'not-supported', reason: 'test fixture, never in a shipped document' }
		})
	});
	registerBlockComponent(declaredPluginKind(KIND), defineBlockComponent(OpaqueContainerBlock));
}

interface MountedOpaque {
	containerApi: ContainerBlockComponent;
	box: HTMLElement;
	surface: HTMLElement;
	blockEdit: ReturnType<typeof makeStubBlockEdit>;
	dispose(): Promise<void>;
}

function mountOpaque(): MountedOpaque {
	const node: CstNode = { kind: declaredPluginKind(KIND), leadingTrivia: '', raw: 'diagram\n' };
	const doc: Document = { kind: 'document', prefix: '', children: [node], suffix: '' };
	const blockEdit = makeStubBlockEdit();
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(OpaqueContainerBlock, {
		target,
		props: { node, index: 0, myPath: [0] },
		context: editorMountContext({ blockEdit, doc: { doc: () => doc } })
	});
	flushSync();
	return {
		containerApi: instance.containerApi,
		box: target.querySelector('.opaque-container') as HTMLElement,
		surface: target.querySelector('.opaque-surface') as HTMLElement,
		blockEdit,
		dispose: async () => {
			await unmount(instance);
			target.remove();
		}
	};
}

beforeEach(() => {
	resetPluginPlatformForTests();
	installEditorDomStubsForTests();
	registerOpaqueKind();
});

afterEach(() => {
	document.body.innerHTML = '';
	resetPluginPlatformForTests();
});

describe('a container kind declaring editable: false', () => {
	it('mounts a surface reporting the declared value, not the shim default', async () => {
		const opaque = mountOpaque();
		expect(opaque.containerApi.editable).toBe(false);
		await opaque.dispose();
	});

	// The declaration reaches the flag the editor actually gates on, so the two agree
	// rather than the surface saying one thing and merge/search reading another.
	it('agrees with the descriptor flag the gates read', () => {
		expect(isBlockEditable(declaredPluginKind(KIND))).toBe(false);
	});

	it('keeps its caret surface: focusable, and focus lands inside its own box', async () => {
		const opaque = mountOpaque();
		expect(opaque.containerApi.focusable).toBe(true);

		opaque.containerApi.focus(0);
		expect(opaque.box.contains(document.activeElement)).toBe(true);
		// The focused block answers a cursor query, so traversal and selection still see it.
		expect(opaque.containerApi.getCursorOffset()).toBe(0);
		await opaque.dispose();
	});

	it('takes no text input: a typed character mints the paragraph below instead', async () => {
		const opaque = mountOpaque();
		opaque.containerApi.focus(0);

		opaque.surface.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true })
		);
		flushSync();

		expect(opaque.blockEdit.updateBlockContent).not.toHaveBeenCalled();
		expect(opaque.blockEdit.insertParagraph).toHaveBeenCalledWith(1, 'x');
		await opaque.dispose();
	});
});
