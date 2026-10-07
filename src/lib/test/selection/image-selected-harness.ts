// A mounted editor whose first paragraph is an image, selected the way a click on it selects it,
// with the public selection events it emits from then on.

import { mountEditor, surfaceAt, type MountedEditor } from '$lib/test/harness/mount-editor.svelte';
import type { EditorProps } from '$lib/editor-props';
import type { EditorSelection } from '$lib/selection/primitives';
import type { EditorTestSurface } from '$lib/components/editor-root-test-surface';

export interface ImageSelected {
	editor: MountedEditor<EditorTestSurface>;
	/** Every `selectionChange` payload since the image was selected. */
	seen: (EditorSelection | null)[];
	selectImage(): Promise<void>;
	overlayMounted(): boolean;
}

/** Mounts `source` (an image alone in block 0) with the image's paragraph focused, as a click
 *  leaves it; `select: false` mounts it without selecting the image. */
export async function mountImageSelected(
	source: string,
	props: Partial<EditorProps> = {},
	opts: { select?: boolean } = {}
): Promise<ImageSelected> {
	const editor = mountEditor<EditorTestSurface>({ source, ...props });
	await editor.settle();
	const seen: (EditorSelection | null)[] = [];
	const h: ImageSelected = {
		editor,
		seen,
		async selectImage() {
			surfaceAt(editor, [0]).focus();
			editor.target.querySelector('.editor')!.dispatchEvent(
				new CustomEvent('image-widget-select', {
					detail: { paragraphPath: [0], sourceStart: 0, preSelectOffset: 0 }
				})
			);
			await editor.settle();
		},
		overlayMounted: () => editor.target.querySelector('[data-image-overlay]') !== null
	};
	if (opts.select !== false) await h.selectImage();
	editor.instance.getEvents().on('selectionChange', (selection) => seen.push(selection));
	return h;
}
