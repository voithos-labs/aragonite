// The render-primary editable leaf registered as a plugin kind, mounted on its own or installed in
// an editor: the fixture every editable-leaf suite drives. It comes in two forms, the Svelte
// `RevealLeafBlock.svelte` and a DOM view of the same markup, for rows where the host's wiring
// could differ between them.

import { expect } from 'vitest';
import RevealLeafBlock from './RevealLeafBlock.svelte';
import DomBlockHost from '#lib/components/dom-block-view/DomBlockHost.svelte';
import {
	defineBlockView,
	definePlugin,
	type BlockView,
	type BlockViewState,
	type EditorPlugin
} from '#lib/plugin.js';
import { svelteBlockView } from '#lib/svelte.js';
import { domViewSpec } from '#lib/schema/block-view.js';
import type { BlockComponent, EditableLeafBlockApi } from '#lib/block-component.js';
import type { CstNode, Document, PluginBlockKind } from '#lib/core/nodes.js';
import { trimTrailingLineEnding } from '#lib/core/lines.js';
import { mountBlock, type MountBlockOptions } from '../../harness/mount-block';
import { settleEditor } from '#lib/test/harness/settle.js';
import { testLeaf, type TestKindFields } from '#lib/test/harness/test-kinds.js';
import type { BlockKindDescriptor } from '#lib/schema/block-kind-descriptor.js';

export type RevealLeafForm = 'RevealLeafBlock.svelte' | 'a DOM view';
export const REVEAL_LEAF_FORMS: RevealLeafForm[] = ['RevealLeafBlock.svelte', 'a DOM view'];

/** What both forms take: a one-line kind, a source painter, and where each source change goes. */
export interface RevealLeafProps {
	singleLine?: boolean;
	paint?: (text: string) => DocumentFragment;
	onSourceEdit?: (text: string) => void;
}

/** `RevealLeafBlock.svelte` as a DOM view: the wrapper takes the rendered half's bundle, and a
 *  fresh source element mounts on each reveal, as the component's `{#if}` does. */
export function domRevealLeaf(props: RevealLeafProps = {}): BlockView {
	return defineBlockView({
		surface: 'render-primary',
		singleLine: props.singleLine,
		renderSource: props.paint,
		mount(target, ctx) {
			target.className = 'reveal-leaf-block';
			ctx.leaf.attachRendered(target);
			const rendered = document.createElement('div');
			rendered.className = 'reveal-leaf-render';
			let source: HTMLElement | null = null;
			const draw = ({ revealed, node }: BlockViewState) => {
				rendered.textContent = node.raw;
				if (revealed ? source : target.firstChild === rendered) return;
				source = revealed ? document.createElement('div') : null;
				if (source) source.className = 'reveal-leaf-source';
				target.replaceChildren(source ?? rendered);
				ctx.leaf.attach(source);
			};
			draw(ctx.state());
			return { update: draw, afterInput: props.onSourceEdit };
		}
	});
}

function revealLeafView(form: RevealLeafForm | BlockView): BlockView {
	if (typeof form !== 'string') return form;
	return form === 'a DOM view' ? domRevealLeaf() : svelteBlockView(RevealLeafBlock);
}

export function registerRevealLeafKind(name: string, over: TestKindFields = {}): PluginBlockKind {
	return testLeaf(name, (kind) => ({
		...(typeof over === 'function' ? over(kind) : over)
	}));
}

/** The same leaf installed as a plugin whose block is one `@@ ` line, for a suite that mounts an
 *  editor; `form` may be a view of the suite's own. */
export function revealLeafPlugin(
	name: string,
	form: RevealLeafForm | BlockView = 'RevealLeafBlock.svelte',
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
				view: revealLeafView(form)
			}));
		}
	});
}

export function leafDocument(kind: PluginBlockKind, raw: string): Document {
	const node = { kind, leadingTrivia: '', raw } as CstNode;
	return { kind: 'document', prefix: '', children: [node], suffix: '' };
}

export interface MountRevealLeafOptions extends Omit<MountBlockOptions, 'doc' | 'source' | 'path'> {
	form?: RevealLeafForm;
	props?: RevealLeafProps & Record<string, unknown>;
}

export function mountRevealLeaf(doc: Document, options: MountRevealLeafOptions = {}) {
	const { form = 'RevealLeafBlock.svelte', ...rest } = options;
	const mounted =
		form === 'a DOM view'
			? mountBlock(DomBlockHost, {
					doc,
					...rest,
					props: { spec: domViewSpec(domRevealLeaf(rest.props)) }
				})
			: mountBlock(RevealLeafBlock, { doc, ...rest });
	// Both forms publish the editable leaf's surface: the component as an export, the host by ref.
	const blockApi = (): EditableLeafBlockApi => {
		const instance = mounted.instance as { blockApi?: BlockComponent; viewRef?(): BlockComponent };
		return (instance.blockApi ?? instance.viewRef?.()) as EditableLeafBlockApi;
	};
	return {
		...mounted,
		/** What the editor calls on the block, whichever form drew it. */
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
