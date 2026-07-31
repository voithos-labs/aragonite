<script module lang="ts">
	import { devProbePlugin } from './dev-probe';

	// Module scope so the factory runs once per process, not once per (SSR) render.
	const plugins = [devProbePlugin()];
</script>

<script lang="ts">
	import { Editor } from 'aragonite';
	import 'aragonite/styles/editor-theme.css';

	// The prop installs before the Editor parses `source`, so the seed materializes the
	// devprobe kind; unmaterialized, it renders nothing and the guard never fires.
	const SEED = ':::devprobe\nbody\n:::\n';
</script>

<Editor source={SEED} theme="light" {plugins} />
