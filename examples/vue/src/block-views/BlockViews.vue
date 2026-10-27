<!-- The adapter suite's `?block-views` page (`examples/adapter-suite/requirements/block-views.md`):
     three blocks drawn by Vue components through `vueBlockView`, and an inline widget and a
     decoration badge through `vueView`. -->
<script setup lang="ts">
import { inject, ref } from 'vue';
import { Aragonite } from '@voithos-labs/aragonite-vue';
import type { EditorPluginEntry } from '@voithos-labs/aragonite';
import { BLOCK_VIEWS_SOURCE, LONG_SOURCE } from '../../../adapter-suite/block-view-kinds';

const ANOTHER = '%% another memo\n\nplain text\n';
const plugins = inject<EditorPluginEntry[]>('block-view-plugins');
const value = ref(BLOCK_VIEWS_SOURCE);
const shown = ref(true);
</script>

<template>
	<main>
		<button data-testid="load" @click="value = ANOTHER">Load another doc</button>
		<button data-testid="load-long" @click="value = LONG_SOURCE">Load a long doc</button>
		<button data-testid="unmount" @click="shown = !shown">{{ shown ? 'Unmount' : 'Mount' }}</button>
		<Aragonite
			v-if="shown"
			:model-value="value"
			:plugins="plugins"
			theme="light"
			class="block-views-editor"
			@update:model-value="value = $event"
		/>
		<pre data-testid="mirror">{{ value }}</pre>
	</main>
</template>
