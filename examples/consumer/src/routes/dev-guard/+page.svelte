<script lang="ts">
	import { Editor } from 'aragonite';
	import 'aragonite/styles/editor-theme.css';
	import { activateDirectives } from 'aragonite/plugin';
	import { registerDevProbe } from './dev-probe';

	// Registration precedes the Editor mount so the seed parses to the devprobe kind
	// and the block materializes — an unmaterialized kind renders nothing and, with
	// nothing to render, trips no guard.
	activateDirectives();
	registerDevProbe();

	const SEED = ':::devprobe\nbody\n:::\n';
</script>

<Editor source={SEED} theme="light" />
