<!-- An inline chip, `{{name}}`, drawn through `vueView`. Two root nodes on purpose: a slot prop it
     doesn't declare would warn on a fragment root, and the page fails on any warning. -->
<script setup lang="ts">
import { inject, onMounted, onUnmounted } from 'vue';
import type { InlineNode } from '@voithos-labs/aragonite/plugin';
import { viewMounted } from '../../../adapter-suite/live-views';

defineProps<{ source: string; inline: InlineNode }>();
const by = inject('framework-name', 'no provider');
let unmounted = () => {};
onMounted(() => (unmounted = viewMounted()));
onUnmounted(() => unmounted());
</script>

<template>
	<span class="chip" :data-start="inline.start">{{ source.slice(2, -2) }} by {{ by }}</span>
	<span class="chip-tail"></span>
</template>
