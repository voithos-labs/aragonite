// One CodeBlock mounted from Markdown, with the stub blockEdit as the commit sink the caller
// reads back.

import CodeBlock from '$lib/components/blocks/code/CodeBlock.svelte';
import { mountBlock } from '../../harness/mount-block';
import type { MountContextOverrides } from '../../harness/mount-context';

export function mountCode(source: string, overrides: MountContextOverrides = {}) {
	const mounted = mountBlock(CodeBlock, { source, overrides });
	return { ...mounted, el: mounted.target.querySelector('.code-block') as HTMLElement };
}

export type MountedCode = ReturnType<typeof mountCode>;
