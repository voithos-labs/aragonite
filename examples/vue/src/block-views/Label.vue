<!-- A click-to-edit label: the text shows only while the caret is in it, beside a preview that
     follows it as it's typed. -->
<script setup lang="ts">
import { computed } from 'vue';
import type { BlockProps } from '@voithos-labs/aragonite-vue';
import type { TextDrawContext } from '@voithos-labs/aragonite/plugin';

const props = defineProps<BlockProps<never, TextDrawContext>>();
const caption = computed(() => (props.ctx.typed ?? props.block.text).slice('@@ '.length).trim());
</script>

<template>
	<span v-if="!ctx.focused" class="label-text">{{ caption }}</span>
	<span class="label-source"><Slot of="source" /></span>
	<span v-if="ctx.focused" class="label-preview">{{ caption }}</span>
</template>
