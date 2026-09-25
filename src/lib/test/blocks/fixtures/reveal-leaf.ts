// The render-primary editable leaf (`RevealLeafBlock.svelte`) registered as a plugin kind and
// mounted on its own, the fixture every editable-leaf suite drives.

import { expect } from 'vitest';
import RevealLeafBlock from './RevealLeafBlock.svelte';
import { declarePluginKind, registerBlockKind, simpleLeafClosure } from '$lib/plugin';
import type { BlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import type { CstNode, Document, PluginBlockKind } from '$lib/core/nodes';
import { trimTrailingLineEnding } from '$lib/core/lines';
import { mountBlock, type MountBlockOptions } from '../../harness/mount-block';
import { settleEditor } from '$lib/test/harness/settle';

export function registerRevealLeafKind(
	name: string,
	over: Partial<BlockKindDescriptor> = {}
): PluginBlockKind {
	const kind = declarePluginKind(name);
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
		}),
		...over
	});
	return kind;
}

/** A one-block document holding the leaf's bytes. */
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
			mounted.instance.parkCaret(trimTrailingLineEnding(doc.children[0].raw).length);
			await settleEditor();
			const el = mounted.target.querySelector<HTMLElement>('.reveal-leaf-source');
			expect(el, 'the reveal mounted no source element').not.toBeNull();
			return el!;
		}
	};
}
