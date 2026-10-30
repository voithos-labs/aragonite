import { createApp } from 'vue';
import '@voithos-labs/aragonite/style.css';
import '@voithos-labs/aragonite/styles/editor-theme.css';
import '../../adapter-suite/block-views.css';
import App from './App.vue';
import SharedPlugin from './SharedPlugin.vue';
import BareBoolean from './BareBoolean.vue';
import BlockViews from './block-views/BlockViews.vue';
import { blockViewPlugins } from './block-views/plugins';

const query = new URLSearchParams(location.search);
const page = query.has('shared-plugin')
	? createApp(SharedPlugin)
	: query.has('bare-boolean')
		? createApp(BareBoolean)
		: query.has('block-views')
			? createApp(BlockViews)
			: createApp(App, { uncontrolled: query.has('uncontrolled') });
if (query.has('block-views')) {
	page.provide('badge-text', 'memo by vue');
	page.provide('framework-name', 'vue');
	page.provide('block-view-plugins', blockViewPlugins(page));
}
page.mount('#app');
