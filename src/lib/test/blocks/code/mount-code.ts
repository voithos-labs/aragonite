// One CodeBlock mounted from Markdown over the shared editor context, with the stub
// blockEdit as the commit sink the caller reads back.

import { mount, unmount, flushSync } from 'svelte';
import CodeBlock from '$lib/components/blocks/code/CodeBlock.svelte';
import { parse } from '$lib/core/parser';
import { makeStubBlockEdit } from '../../harness/editor-actions';
import { editorMountContext, type MountContextOverrides } from '../../harness/mount-context';

export function mountCode(source: string, overrides: MountContextOverrides = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const doc = parse(source);
	const blockEdit = makeStubBlockEdit();
	const instance = mount(CodeBlock, {
		target,
		props: { node: doc.children[0], index: 0, myPath: [0] },
		context: editorMountContext({
			...overrides,
			blockEdit,
			doc: { doc: () => doc, ...overrides.doc }
		})
	});
	flushSync();
	return {
		instance,
		target,
		el: target.querySelector('.code-block') as HTMLElement,
		blockEdit,
		dispose: async () => {
			await unmount(instance);
			target.remove();
		}
	};
}

export type MountedCode = ReturnType<typeof mountCode>;
