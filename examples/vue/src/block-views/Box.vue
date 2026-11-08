<!-- A box whose child blocks the editor mounts in the `children` slot. `data-length` changes with
     every edit inside the box, so the slot's parent renders again while its children are typed in. -->
<script setup lang="ts">
import type { BlockProps } from '@voithos-labs/aragonite-vue';
import type { ContainerDrawContext } from '@voithos-labs/aragonite/plugin';

defineProps<BlockProps<never, ContainerDrawContext>>();
</script>

<template>
	<span class="box-badge">box by vue</span>
	<div class="box-children" :data-length="block.text.length"><Slot of="children" /></div>
</template>
