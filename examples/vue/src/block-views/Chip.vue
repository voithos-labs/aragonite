<!-- An inline chip, `{{name}}`, drawn through `vueView`; `{{boom}}` throws. Two root nodes on
     purpose: a slot prop it doesn't declare would warn on a fragment root, and the page fails on
     any warning. -->
<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted } from 'vue';
import type { InlineNode } from '@voithos-labs/aragonite/plugin';
import { BOOM } from '../../../adapter-suite/block-view-kinds';
import { viewMounted } from '../../../adapter-suite/live-views';

const props = defineProps<{ source: string; inline: InlineNode }>();
// Thrown while rendering, where React's chip throws too.
const name = computed(() => {
	if (props.source === BOOM) throw new Error('the chip went boom');
	return props.source.slice(2, -2);
});
const by = inject('framework-name', 'no provider');
let unmounted = () => {};
onMounted(() => (unmounted = viewMounted()));
onUnmounted(() => unmounted());
</script>

<template>
	<span class="chip" :data-start="inline.start">{{ name }} by {{ by }}</span>
	<span class="chip-tail"></span>
</template>
