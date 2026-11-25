<script module lang="ts">
	import { devProbePlugin } from './dev-probe';

	const plugins = [devProbePlugin];
</script>

<script lang="ts">
	import { Editor } from '@voithos-labs/aragonite/svelte';
	import '@voithos-labs/aragonite/styles/editor-theme.css';

	// The editor reads `source` with its plugins, so the seed is the devprobe box from the start.
	const SEED = ':::devprobe\nbody\n:::\n';
</script>

<Editor source={SEED} theme="light" {plugins} />
