<script module lang="ts">
	import { devProbePlugin } from './dev-probe';

	// Module scope so the factory runs once per process, not once per (SSR) render.
	// The prop installs before the Editor parses `source`, so the seed materializes
	// the devprobe kind — an unmaterialized kind renders nothing and trips no guard.
	const plugins = [devProbePlugin()];
</script>

<script lang="ts">
	import { Editor } from 'aragonite';
	import 'aragonite/styles/editor-theme.css';

	const SEED = ':::devprobe\nbody\n:::\n';
</script>

<Editor source={SEED} theme="light" {plugins} />
