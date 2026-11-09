// The render-primary editable leaf (`RevealLeafBlock.svelte`) registered as a plugin kind, mounted
// on its own or installed in an editor: the fixture every editable-leaf suite drives.

import { expect } from 'vitest';
import RevealLeafBlock from './RevealLeafBlock.svelte';
import { definePlugin, type BlockView, type EditorPlugin } from '#lib/plugin.js';
import { svelteBlockView } from '#lib/svelte.js';
import type { EditableLeafBlockApi } from '#lib/block-component.js';
import type { CstNode, Document, PluginBlockKind } from '#lib/core/nodes.js';
import { trimTrailingLineEnding } from '#lib/core/lines.js';
import { mountBlock, type MountBlockOptions } from '../../harness/mount-block';
import { settleEditor } from '#lib/test/harness/settle.js';
import { testLeaf, type TestKindFields } from '#lib/test/harness/test-kinds.js';
import type { BlockKindDescriptor } from '#lib/schema/block-kind-descriptor.js';

/** What the leaf takes: a one-line kind, a source painter, and where each source change goes. */
export interface RevealLeafProps {
	singleLine?: boolean;
	paint?: (text: string) => DocumentFragment;
	onSourceEdit?: (text: string) => void;
}

export function registerRevealLeafKind(name: string, over: TestKindFields = {}): PluginBlockKind {
	return testLeaf(name, (kind) => ({
		...(typeof over === 'function' ? over(kind) : over)
	}));
}

/** The same leaf installed as a plugin whose block is one `@@ ` line, for a suite that mounts an
 *  editor; `view` may be one of the suite's own. */
export function revealLeafPlugin(
	name: string,
	view: BlockView = svelteBlockView(RevealLeafBlock),
	over: Pick<BlockKindDescriptor, 'caretTargetAtPoint'> = {}
): EditorPlugin {
	return definePlugin({
		name,
		setup: () => {
			registerRevealLeafKind(name, (kind) => ({
				opener: {
					priority: 25,
					interruptsParagraph: false,
					tryOpen: (ctx) =>
						ctx.line.text.startsWith('@@ ')
							? { node: { kind, leadingTrivia: ctx.leadingTrivia, raw: ctx.line.raw }, consumed: 1 }
							: null
				},
				...over,
				view
			}));
		}
	});
}

export function leafDocument(kind: PluginBlockKind, raw: string): Document {
	const node = { kind, leadingTrivia: '', raw } as CstNode;
	return { kind: 'document', prefix: '', children: [node], suffix: '' };
}

export interface MountRevealLeafOptions extends Omit<MountBlockOptions, 'doc' | 'source' | 'path'> {
	props?: RevealLeafProps & Record<string, unknown>;
}

export function mountRevealLeaf(doc: Document, options: MountRevealLeafOptions = {}) {
	const mounted = mountBlock(RevealLeafBlock, { doc, ...options });
	const blockApi = () => (mounted.instance as { blockApi: EditableLeafBlockApi }).blockApi;
	return {
		...mounted,
		/** What the editor calls on the block. */
		get blockApi(): EditableLeafBlockApi {
			return blockApi();
		},
		/** Reveal the source with the caret at the end of the block's bytes. */
		async revealAtEnd(): Promise<HTMLElement> {
			blockApi().parkCaret(trimTrailingLineEnding(doc.children[0].raw).length);
			await settleEditor();
			const el = mounted.target.querySelector<HTMLElement>('.reveal-leaf-source');
			expect(el, 'the reveal mounted no source element').not.toBeNull();
			return el!;
		}
	};
}
