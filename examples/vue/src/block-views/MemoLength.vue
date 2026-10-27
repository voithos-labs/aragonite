<!-- The badge on a memo, showing the length its decoration carries, drawn through `vueView`. -->
<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted } from 'vue';
import type { Decoration } from '@voithos-labs/aragonite/plugin';
import { MEMO_LENGTH_ATTR } from '../../../adapter-suite/block-view-kinds';
import { viewMounted } from '../../../adapter-suite/live-views';

const props = defineProps<{ decoration: Decoration }>();
const by = inject('framework-name', 'no provider');
const length = computed(() =>
	props.decoration.type === 'block' ? props.decoration.attrs?.[MEMO_LENGTH_ATTR] : '?'
);
let unmounted = () => {};
onMounted(() => (unmounted = viewMounted()));
onUnmounted(() => unmounted());
</script>

<template>
	<span class="memo-length">{{ length }} by {{ by }}</span>
</template>
