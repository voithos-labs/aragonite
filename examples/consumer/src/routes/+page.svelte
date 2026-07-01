<script lang="ts">
	import { Editor } from 'aragonite';
	import type { EditorInstance } from 'aragonite';
	import 'aragonite/styles/editor-theme.css';
	import '../plugin-probe';

	let editor = $state<EditorInstance>();
</script>

<h1>aragonite consumer harness</h1>
<Editor bind:this={editor} source={'# Hello\n\nType here.'} theme="light" />
