<!-- A memo line: the editor edits its text in the `source` slot, and the badge reads the host
     app's `provide`, which reaches it through `vueBlock`'s `app` option. -->
<script setup lang="ts">
import { inject } from 'vue';
import type { BlockProps } from '@voithos-labs/aragonite-vue';
import type { TextDrawContext } from '@voithos-labs/aragonite/plugin';

defineProps<BlockProps<never, TextDrawContext>>();
const badge = inject('badge-text', 'no provider');
</script>

<template>
	<span class="memo-badge">{{ badge }}</span>
	<span class="memo-text"><Slot of="source" /></span>
</template>
