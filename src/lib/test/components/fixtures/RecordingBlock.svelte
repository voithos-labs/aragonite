<script lang="ts">
	// A registrable block component that keeps the props BlockHost handed it, so a
	// test can ask what the dispatcher actually delivered. `document` is renamed on
	// destructure for the reason TextEditableBlock names: binding it would shadow
	// the global.
	import type { DocumentView, NodeView } from '../../../core/node-views';
	import type { EditorRects } from '../../../editor-rects';

	let {
		node,
		index,
		myPath = [],
		ambientPrefix = '',
		document: hostDocument,
		rects,
		badge = ''
	}: {
		node: NodeView;
		index: number;
		myPath?: number[];
		ambientPrefix?: string;
		document?: DocumentView;
		rects?: EditorRects;
		badge?: string;
	} = $props();

	export const editable = true;
	export const focusable = true;
	export function focus(): void {}
	export function getCursorOffset(): number | null {
		return null;
	}

	export function deliveredProps(): {
		document: DocumentView | undefined;
		rects: EditorRects | undefined;
		myPath: number[];
		index: number;
		ambientPrefix: string;
		badge: string;
	} {
		return { document: hostDocument, rects, myPath, index, ambientPrefix, badge };
	}
</script>

<div class="recording-block" data-badge={badge}>{node.raw}</div>
