<script lang="ts">
	import type { Decoration } from '../../../decorations/types';

	let { decoration }: { decoration: Decoration } = $props();
</script>

<span class="badge-fixture">{decoration.type}</span>
