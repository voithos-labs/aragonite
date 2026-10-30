import { h, type App, type Component } from 'vue';
import type { PluginView } from '@voithos-labs/aragonite/plugin';
import { createViewRoot } from './view-root.js';

export interface VueViewOptions {
	/** The host app, whose `provide`s, global components and plugins the view then sees; without
	 *  it the view renders apart from any app. */
	app?: App;
}

/** An inline widget, decoration widget or badge, or menu row drawn by `component`, given the slot's
 *  props it declares; it fits any slot whose props include those. Each `update` re-renders it. */
export function vueView<P extends object>(
	component: Component,
	options: VueViewOptions = {}
): PluginView<P> {
	const keep = declaredProps(component);
	return (target, props) => {
		const root = createViewRoot(target, options.app);
		const draw = (next: P) => root.render(h(component, keep(next)));
		draw(props);
		return { update: draw, destroy: root.unmount };
	};
}

type Props = Record<string, unknown>;

// A prop the component doesn't declare would fall through as a DOM attribute (a function, say),
// and a fragment root warns about it.
function declaredProps(component: Component): (props: object) => Props {
	if (typeof component === 'function') return (props) => ({ ...props });
	const declared = (component as { props?: string[] | Props }).props ?? [];
	const keys = Array.isArray(declared) ? declared : Object.keys(declared);
	return (props) =>
		Object.fromEntries(
			keys.filter((key) => key in props).map((key) => [key, (props as Props)[key]])
		);
}
