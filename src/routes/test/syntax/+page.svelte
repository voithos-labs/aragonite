<script lang="ts">
	import { Editor } from '$lib';
	import { describeConvergence } from '$lib/testing/parse-convergence';
	import { trackParityDocument } from '../../parity-documents.svelte';

	// Two editors over one seed: the first switches indented code and setext headings off, the
	// second keeps GFM as shipped. A loaded file shows each reading of the same bytes.
	const SEED = 'Loaded\n\n\tcode\n\nPlan\n---\n';
	const OFF = { indentedCode: false, setextHeading: false };

	let switchedOff = $state<ReturnType<typeof Editor>>();
	let shipped = $state<ReturnType<typeof Editor>>();

	trackParityDocument(() => switchedOff);
	trackParityDocument(() => shipped);

	// What each editor holds, and where its tree first differs from a reload in its own grammar.
	$effect(() => {
		const pane = (pane: 'off' | 'on') => (pane === 'off' ? switchedOff : shipped);
		(window as unknown as { __syntax?: unknown }).__syntax = {
			source: (which: 'off' | 'on') => pane(which)?.getSource() ?? '',
			divergence: (which: 'off' | 'on') => {
				const editor = pane(which);
				if (!editor) return 'not mounted';
				return describeConvergence(editor.__test.getDocument(), editor.__test.getGrammar());
			}
		};
	});
</script>

<div class="syntax-harness aragonite-editor-theme">
	<div class="pane" data-testid="editor-off">
		<Editor bind:this={switchedOff} source={SEED} syntax={OFF} presentationMode="live" />
	</div>
	<div class="pane" data-testid="editor-on">
		<Editor bind:this={shipped} source={SEED} presentationMode="live" />
	</div>
</div>

<style>
	.syntax-harness {
		width: 100vw;
		height: 100vh;
		display: flex;
	}
	.pane {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
</style>
