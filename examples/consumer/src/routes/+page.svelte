<script lang="ts">
	import { Editor } from '@voithos-labs/aragonite';
	import type { EditorInstance } from '@voithos-labs/aragonite';
	import '@voithos-labs/aragonite/styles/editor-theme.css';
	import '../plugin-probe';

	let editor = $state<EditorInstance>();
</script>

<h1>aragonite consumer harness</h1>
<Editor bind:this={editor} source={'# Hello\n\nType here.'} theme="light" />
