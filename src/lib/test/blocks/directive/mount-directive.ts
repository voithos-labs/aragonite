// The generic `:::name` container mounted on its own, standing in for every plugin container. It
// is built on the public `createContainerBlock` helper and passes none of its optional
// dependencies, so every refusal fires here, and mounting it alone is what hands a test the
// published `containerApi`.

import { expect } from 'vitest';
import DirectiveContainerBlock from '$lib/components/blocks/directive/DirectiveContainerBlock.svelte';
import { activateDirectives } from '$lib/components/blocks/directive/activate-directives';
import type { ContainerBlockComponent } from '$lib/block-component';
import { installEditorDomStubsForTests } from '$lib/testing';
import { mountBlock, type MountedBlock } from '../../harness/mount-block';
import type { MountContextOverrides } from '../../harness/mount-context';

export function installDirectiveStubs(): void {
	activateDirectives();
	installEditorDomStubsForTests();
}

export interface MountedDirective extends MountedBlock<unknown> {
	box: HTMLElement;
	containerApi: ContainerBlockComponent;
}

export function mountDirective(
	source: string,
	overrides: MountContextOverrides = {}
): MountedDirective {
	const mounted = mountBlock(DirectiveContainerBlock, { source, overrides });
	expect(mounted.node.kind).toBe('directiveContainer');
	return {
		...mounted,
		box: mounted.target.querySelector('.directive-block') as HTMLElement,
		containerApi: mounted.instance.containerApi
	};
}
