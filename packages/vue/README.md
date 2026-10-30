# @voithos-labs/aragonite-vue

Aragonite as a vue component; works with vue 3.3+, nuxt included. What is aragonite? Read the short (your mileage may vary) [readme](https://github.com/voithos-labs/aragonite/blob/main/README.md), or try it out at [aragonite.dev](https://aragonite.dev).

## Install

Install the core package and this component:

```bash
npm install @voithos-labs/aragonite @voithos-labs/aragonite-vue
```

## Use it

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { Aragonite, type AragoniteInstance } from '@voithos-labs/aragonite-vue';
import '@voithos-labs/aragonite/style.css';
import '@voithos-labs/aragonite/styles/editor-theme.css';

const text = ref('> That is not dead which can eternal lie,\n> And with strange aeons even death may die.\n');
const editor = ref<AragoniteInstance | null>(null);
</script>

<template>
	<Aragonite ref="editor" v-model="text" theme="light" style="height: 70vh">
		<template #header><input placeholder="Title" /></template>
	</Aragonite>
</template>
```

Relevant (or irrelevant, fuck if i know) details:

- Rather not bind? Pass `default-value` instead of `v-model` and the editor keeps the document itself.
- Every other prop is an editor option (`theme`, `plugins`, ...), and the ref's `handle` gets you `getSource()`, `runCommand()` and friends once it mounts.
- Nuxt: no `<ClientOnly>` needed, it renders on the server just fine. Put the two stylesheets in `nuxt.config`'s `css` array instead of importing them.
- Writing a plugin? Its blocks can be vue components too: `vueBlockView` turns one into a block view, and `vueView` does the same for an inline widget, a decoration or a menu row ([react and vue blocks](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/plugin-guide/react-and-vue.md)).

## More

The [consumer guide](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/consumer-guide.md#vue) has the rest: props, handle's methods, events, theming, etc. etc.

## License

Aragonite is free software, released under [MPL-2.0](./LICENSE): use it, study it, fork it, embed it in whatever you're building, closed source included. The one string attached: if you change aragonite's own files, you share those changes under the same license.
