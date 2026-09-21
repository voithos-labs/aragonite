// The generic `:::name` container mounted on its own over a real CST, standing in for every
// plugin container. It is built on the public `createContainerBlock` helper and passes none of
// its optional dependencies, so every refusal fires here, and mounting it alone is what hands a
// test the published `containerApi`. Ask it read-only questions: a commit replaces the container
// node, and with no parent above it nothing re-renders with the replacement.

import { mount, unmount, flushSync } from 'svelte';
import { expect } from 'vitest';
import DirectiveContainerBlock from '$lib/components/blocks/directive/DirectiveContainerBlock.svelte';
import { activateDirectives } from '$lib/components/blocks/directive/activate-directives';
import type { ContainerBlockComponent } from '$lib/block-component';
import { parse } from '$lib/core/parser';
import { installEditorDomStubsForTests } from '$lib/testing';
import { makeStubBlockEdit } from '../../harness/editor-actions';
import { editorMountContext, type MountContextOverrides } from '../../harness/mount-context';

export function installDirectiveStubs(): void {
	activateDirectives();
	installEditorDomStubsForTests();
}

export interface MountedDirective {
	target: HTMLElement;
	box: HTMLElement;
	containerApi: ContainerBlockComponent;
	blockEdit: ReturnType<typeof makeStubBlockEdit>;
	dispose(): Promise<void>;
}

export function mountDirective(
	source: string,
	overrides: MountContextOverrides = {}
): MountedDirective {
	const doc = parse(source);
	expect(doc.children[0].kind).toBe('directiveContainer');

	const blockEdit = overrides.blockEdit ?? makeStubBlockEdit();
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(DirectiveContainerBlock, {
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
		target,
		box: target.querySelector('.directive-block') as HTMLElement,
		containerApi: instance.containerApi,
		blockEdit: blockEdit as ReturnType<typeof makeStubBlockEdit>,
		dispose: async () => {
			await unmount(instance);
			target.remove();
		}
	};
}

/** Dispatch a bubbling, cancelable keydown at `el` and report whether it was consumed. */
export function pressOn(el: HTMLElement, init: KeyboardEventInit): boolean {
	const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
	el.dispatchEvent(event);
	return event.defaultPrevented;
}
