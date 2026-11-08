// The childless whole-block container fixture, registered the way a plugin registers one and
// mounted on its own over the standard block context.
import { mount, unmount, flushSync } from 'svelte';
import { declarePluginKind, declaredPluginKind, registerBlockKind } from '#lib/plugin.js';
import { svelteBlockView } from '#lib/svelte.js';
import type { CstNode, Document } from '#lib/core/nodes.js';
import type { ContainerBlockComponent } from '#lib/block-component.js';
import { makeStubBlockEdit } from '../../harness/editor-actions';
import { editorMountContext, type MountContextOverrides } from '../../harness/mount-context';
import OpaqueContainerBlock from './OpaqueContainerBlock.svelte';

export const OPAQUE_KIND = 'opaque-fixture-container';

export function registerOpaqueKind(): void {
	const kind = declarePluginKind(OPAQUE_KIND);
	registerBlockKind(kind, {
		view: svelteBlockView(OpaqueContainerBlock),
		gapEdges: 'none',
		mergeRole: 'not-mergeable',
		// A block whose only edit path would be its own UI.
		editable: false,
		supportsInline: false,
		blockFocus: 'whole-block',
		container: { contract: 'opaque', rebuildRaw: () => {} }
	});
}

export interface MountedOpaque {
	containerApi: ContainerBlockComponent;
	box: HTMLElement;
	surface: HTMLElement;
	blockEdit: ReturnType<typeof makeStubBlockEdit>;
	dispose(): Promise<void>;
}

/** The fixture as block 0 of a one-block document; `overrides` reach the mount context. */
export function mountOpaque(overrides: MountContextOverrides = {}): MountedOpaque {
	const node: CstNode = {
		kind: declaredPluginKind(OPAQUE_KIND),
		leadingTrivia: '',
		raw: 'diagram\n'
	};
	const doc: Document = { kind: 'document', prefix: '', children: [node], suffix: '' };
	const blockEdit = makeStubBlockEdit();
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(OpaqueContainerBlock, {
		target,
		props: { node, index: 0, myPath: [0] },
		context: editorMountContext({ blockEdit, doc: { doc: () => doc }, ...overrides })
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
