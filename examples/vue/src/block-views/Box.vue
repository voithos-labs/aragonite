<!-- A box whose child blocks the editor mounts in the `children` slot. `data-length` changes with
     every edit inside the box, so the slot's parent renders again while its children are typed in.
     An options-API component on purpose: its template finds `<Slot>` by name, never as a prop. -->
<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import type { BlockProps } from '@voithos-labs/aragonite-vue';
import type { ContainerDrawContext } from '@voithos-labs/aragonite/plugin';

type Props = BlockProps<never, ContainerDrawContext>;

export default defineComponent({
	props: {
		block: { type: Object as PropType<Props['block']>, required: true },
		ctx: { type: Object as PropType<Props['ctx']>, required: true },
		Slot: { type: Object as PropType<Props['Slot']>, required: true }
	}
});
</script>

<template>
	<span class="box-badge">box by vue</span>
	<div class="box-children" :data-length="block.text.length"><Slot of="children" /></div>
</template>
