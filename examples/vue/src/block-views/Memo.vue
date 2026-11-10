<!-- A memo line: the editor edits its text in the `source` slot, and the badge reads the host
     app's `provide`, which reaches it through `vueBlock`'s `app` option. An options-API component
     like the box, so `<Slot>` resolves by name inside the host app's context too. -->
<script lang="ts">
import { defineComponent, inject, type PropType } from 'vue';
import type { BlockProps } from '@voithos-labs/aragonite-vue';
import type { TextDrawContext } from '@voithos-labs/aragonite/plugin';

type Props = BlockProps<never, TextDrawContext>;

export default defineComponent({
	props: {
		block: { type: Object as PropType<Props['block']>, required: true },
		ctx: { type: Object as PropType<Props['ctx']>, required: true },
		Slot: { type: Object as PropType<Props['Slot']>, required: true }
	},
	setup() {
		return { badge: inject('badge-text', 'no provider') };
	}
});
</script>

<template>
	<span class="memo-badge">{{ badge }}</span>
	<span class="memo-text"><Slot of="source" /></span>
</template>
