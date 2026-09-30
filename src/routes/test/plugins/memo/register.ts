/** The memo plugin: the plain-mode check on `createEditableLeaf`; see memo-kind.ts. */

import {
	definePlugin,
	registerBlockComponent,
	defineBlockComponent,
	declaredPluginKind,
	type EditorPlugin
} from '$lib/plugin';
import { registerMemoBlock, MEMO_BLOCK } from './memo-kind';
import MemoBlock from './MemoBlock.svelte';

export function memoPlugin(): EditorPlugin {
	return definePlugin({
		name: 'memo',
		setup() {
			registerMemoBlock();
			registerBlockComponent(declaredPluginKind(MEMO_BLOCK), defineBlockComponent(MemoBlock));
		}
	});
}
