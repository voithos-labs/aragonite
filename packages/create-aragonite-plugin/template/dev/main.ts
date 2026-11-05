// The playground: the editor with your plugin, the way a host app without Svelte mounts it.
import { createEditor, type EditorHandle } from '@voithos-labs/aragonite';
import '@voithos-labs/aragonite/style.css';
import '@voithos-labs/aragonite/styles/editor-theme.css';
import { parrotPlugin } from '../src/index';

const editor = createEditor(document.querySelector<HTMLElement>('#editor')!, {
	source: '%%parrot party responsibly\n\nAfter\n',
	plugins: [parrotPlugin()]
});

// The browser tests read the document back through this.
declare global {
	interface Window {
		editor: EditorHandle;
	}
}
window.editor = editor;
