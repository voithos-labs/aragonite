// Mounting one block component on its own over a parsed document, under the standard editor
// context (`mount-context.ts`), the one way every block suite does it. A bare mount keeps the
// node it was handed: a commit replaces it and nothing above re-renders, so ask read-only
// questions or single gestures, and mount the Editor (`mount-editor.svelte.ts`) for more.

import { mount, unmount, flushSync, type Component } from 'svelte';
import type { BlockEditActions } from '$lib/action-contracts';
import type { CstNode, Document } from '$lib/core/nodes';
import { parse } from '$lib/core/parser';
import { nodeAt } from '$lib/tree-operations/node-primitives';
import { makeStubBlockEdit } from './editor-actions';
import { editorMountContext, type MountContextOverrides } from './mount-context';

export interface MountBlockOptions {
	/** The document as Markdown, or `doc` already parsed (a `$state` document stays reactive). */
	source?: string;
	doc?: Document;
	/** The block's doc-absolute path; the first top-level block by default. */
	path?: number[];
	/** Props beside `node`, `index` and `myPath`, or overriding them. Filled in place and handed
	 *  over unwrapped, so a `$state` object stays live for a test that re-dispatches after mount. */
	props?: Record<string, unknown>;
	overrides?: MountContextOverrides;
	/** Context a kind reads beyond the editor's own, such as its list or table context. */
	context?: Iterable<[symbol, unknown]>;
	/** Where the component mounts; a fresh element on the body by default. */
	target?: HTMLElement;
}

export interface MountedBlock<Exports> {
	instance: Exports;
	target: HTMLElement;
	doc: Document;
	node: CstNode;
	/** The commit sink the block writes through: the override, or a spied stub. */
	blockEdit: ReturnType<typeof makeStubBlockEdit>;
	dispose(): Promise<void>;
}

export function mountBlock<Props extends Record<string, any>, Exports extends Record<string, any>>(
	component: Component<Props, Exports, any>,
	options: MountBlockOptions = {}
): MountedBlock<Exports> {
	const doc = options.doc ?? parse(options.source ?? '');
	const path = options.path ?? [0];
	const blockEdit: BlockEditActions = options.overrides?.blockEdit ?? makeStubBlockEdit();
	const target = options.target ?? document.body.appendChild(document.createElement('div'));
	const props = options.props ?? {};
	props.node ??= blockAt(doc, path);
	props.index ??= path[path.length - 1];
	props.myPath ??= path;
	const context = editorMountContext({
		...options.overrides,
		blockEdit,
		doc: { doc: () => doc, ...options.overrides?.doc }
	});
	for (const [key, value] of options.context ?? []) context.set(key, value);
	const instance = mount(component, { target, props: props as Props, context });
	flushSync();
	return {
		instance,
		target,
		doc,
		node: props.node as CstNode,
		blockEdit: blockEdit as ReturnType<typeof makeStubBlockEdit>,
		dispose: async () => {
			await unmount(instance);
			target.remove();
		}
	};
}

function blockAt(doc: Document, path: number[]): CstNode {
	const node = nodeAt(doc, path);
	if (!node || node === doc) throw new Error(`no block at ${JSON.stringify(path)}`);
	return node as CstNode;
}
