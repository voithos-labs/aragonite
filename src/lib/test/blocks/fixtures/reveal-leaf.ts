// The render-primary editable leaf (`RevealLeafBlock.svelte`) registered as a plugin kind, mounted
// on its own or installed in an editor: the fixture every editable-leaf suite drives.

import { expect } from 'vitest';
import RevealLeafBlock from './RevealLeafBlock.svelte';
import {
	definePluginBlock,
	registerBlockOpener,
	simpleLeafClosure,
	type EditorPlugin
} from '#lib/plugin.js';
import type { BlockKindRegistration } from '#lib/schema/block-kind-descriptor.js';
import type { CstNode, Document, PluginBlockKind } from '#lib/core/nodes.js';
import { trimTrailingLineEnding } from '#lib/core/lines.js';
import { mountBlock, type MountBlockOptions } from '../../harness/mount-block';
import { settleEditor } from '#lib/test/harness/settle.js';
import { testLeaf } from '#lib/test/harness/test-kinds.js';

export function registerRevealLeafKind(
	name: string,
	over: Partial<BlockKindRegistration> = {}
): PluginBlockKind {
	return testLeaf(name, {
		closure: simpleLeafClosure({
			focus: { mode: 'implemented', via: 'createEditableLeaf render-primary reveal' },
			searchPaint: { mode: 'inherit-default' },
			undo: { mode: 'implemented', via: 'render-primary: one commit when the caret leaves' },
			simOracle: { mode: 'inherit-default' }
		}),
		...over
	});
}

/** The same leaf installed as a plugin whose block is one `@@ ` line, for a suite that mounts an editor. */
export function revealLeafPlugin(name: string): EditorPlugin {
	return definePluginBlock({
		name,
		kind: name,
		component: RevealLeafBlock,
		register: () => {
			const kind = registerRevealLeafKind(name);
			registerBlockOpener(kind, {
				priority: 25,
				interruptsParagraph: false,
				tryOpen: (ctx) =>
					ctx.line.text.startsWith('@@ ')
						? { node: { kind, leadingTrivia: ctx.leadingTrivia, raw: ctx.line.raw }, consumed: 1 }
						: null
			});
		}
	});
}

export function leafDocument(kind: PluginBlockKind, raw: string): Document {
	const node = { kind, leadingTrivia: '', raw } as CstNode;
	return { kind: 'document', prefix: '', children: [node], suffix: '' };
}

export function mountRevealLeaf(
	doc: Document,
	options: Omit<MountBlockOptions, 'doc' | 'source' | 'path'> = {}
) {
	const mounted = mountBlock(RevealLeafBlock, { doc, ...options });
	return {
		...mounted,
		/** Reveal the source with the caret at the end of the block's bytes. */
		async revealAtEnd(): Promise<HTMLElement> {
			mounted.instance.blockApi.parkCaret(trimTrailingLineEnding(doc.children[0].raw).length);
			await settleEditor();
			const el = mounted.target.querySelector<HTMLElement>('.reveal-leaf-source');
			expect(el, 'the reveal mounted no source element').not.toBeNull();
			return el!;
		}
	};
}
