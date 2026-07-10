<script lang="ts">
	import { Editor, type EditorInstance } from 'aragonite';
	import 'aragonite/styles/editor-theme.css';
	import { activateDirectives } from 'aragonite/plugin';
	import { registerCallout } from '../../plugins/callout/register';
	import { registerDetails } from '../../plugins/details/register';
	import { registerLatexInline } from '../../latex-register';

	// Registration precedes the Editor mount so the seed parses to plugin kinds.
	activateDirectives();
	registerCallout();
	registerDetails();
	registerLatexInline();

	const SEED = [
		':::note Title',
		'Callout body',
		':::',
		'',
		'<details open>',
		'<summary>Summary</summary>',
		'',
		'Details body',
		'',
		'</details>',
		'',
		'Math $x^2$ inline',
		'',
		':::mystery',
		'Unregistered directive body',
		':::',
		''
	].join('\n');

	let editor = $state<EditorInstance>();

	// Round-trip probe for the boundary smoke specs; runs client-side only.
	$effect(() => {
		if (!editor) return;
		(window as { __consumer?: { getSource: () => string } }).__consumer = {
			getSource: () => editor!.getSource()
		};
	});
</script>

<Editor bind:this={editor} source={SEED} theme="light" />
