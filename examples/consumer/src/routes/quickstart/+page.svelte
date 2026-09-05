<script>
	import { Editor } from '@voithos-labs/aragonite';
	import '@voithos-labs/aragonite/styles/editor-theme.css';

	let editor;
	const source = '# Hello\n';
</script>

<div class="aragonite-editor-theme" data-editor-theme="light">
	<Editor bind:this={editor} {source} theme="light" />
</div>
