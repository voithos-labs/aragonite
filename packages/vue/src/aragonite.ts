/**
 * The aragonite editor as a Vue component. `v-model` holds the document, the `header` slot shows
 * above the first block, and every other prop is the editor option of the same name, handed to the
 * editor's `update` after each render, so a changed prop lands live and an unchanged one costs nothing.
 */

import {
	defineComponent,
	h,
	onBeforeUnmount,
	onMounted,
	onUpdated,
	shallowRef,
	Teleport,
	toRaw,
	type SlotsType,
	type VNode
} from 'vue';
import {
	createEditor,
	EDITOR_OPTION_SPECS,
	type CreateEditorOptions,
	type EditorHandle,
	type PluginsProp
} from '@voithos-labs/aragonite';

// The props only Vue has; every other prop is the editor option of the same name.
const VUE_ONLY_KEYS = ['modelValue', 'defaultValue'] as const;

// The editor options Vue takes another way: the document as `modelValue`, the header as a slot.
const SWAPPED_KEYS = ['source', 'header'] as const satisfies readonly (keyof CreateEditorOptions)[];

type OptionKey = Exclude<keyof typeof EDITOR_OPTION_SPECS, (typeof SWAPPED_KEYS)[number]>;

const OPTION_KEYS = (
	Object.keys(EDITOR_OPTION_SPECS) as (keyof typeof EDITOR_OPTION_SPECS)[]
).filter((key): key is OptionKey => !(SWAPPED_KEYS as readonly string[]).includes(key));

// ── Public API ──────────────────────────────────────────────────────────────

/** The editor's options, with the document as `modelValue` (for `v-model`) or `defaultValue`. */
export type AragoniteProps = Omit<CreateEditorOptions, 'source' | 'header'> & {
	/** The document. A changed value loads as a new document, clearing undo, unless it's the text
	 *  the component just emitted; an unchanged one leaves the editor's text alone. */
	modelValue?: string;
	/** The document to start with when `modelValue` isn't bound. */
	defaultValue?: string;
};

/** What a template ref on the component holds: the editor handle once mounted, `null` before. */
export interface AragoniteInstance {
	readonly handle: EditorHandle | null;
}

/** Mounts the editor in the browser; `update:modelValue` carries the whole document after each
 *  edit, undo and redo included, and never after a load. */
export const Aragonite = defineComponent(
	(props: AragoniteProps, { slots, emit, expose }) => {
		const target = shallowRef<HTMLDivElement | null>(null);
		const headerHolder = shallowRef<HTMLElement | null>(null);
		const handle = shallowRef<EditorHandle | null>(null);
		expose({ handle });

		onMounted(() => {
			const holder = document.createElement('div');
			const editor = createEditor(target.value!, {
				...editorOptions(props, slots.header ? holder : null),
				source: props.modelValue ?? props.defaultValue
			});
			editor.getEvents().on('edit', () => emit('update:modelValue', editor.getSource()));
			handle.value = editor;
			headerHolder.value = holder;
		});

		onUpdated(() => {
			handle.value?.update(editorOptions(props, slots.header ? headerHolder.value : null));
		});

		onBeforeUnmount(() => {
			handle.value?.destroy();
			handle.value = null;
		});

		// The header holder only exists in the browser, so the server render and hydration match.
		return () =>
			h(
				'div',
				{ ref: target },
				headerHolder.value && slots.header
					? h(Teleport, { to: headerHolder.value }, slots.header())
					: undefined
			);
	},
	{
		name: 'Aragonite',
		props: declarations(),
		emits: { 'update:modelValue': (value: string) => typeof value === 'string' },
		slots: Object as SlotsType<{ header?: () => VNode[] }>
	}
);

// ── Internal ────────────────────────────────────────────────────────────────

// Vue reads an absent `Boolean` prop as `false`; `default: undefined` leaves the editor's default.
function optionalBoolean() {
	return { type: Boolean, default: undefined } as const;
}

type Declarations = {
	[K in keyof AragoniteProps]-?: [NonNullable<AragoniteProps[K]>] extends [boolean]
		? ReturnType<typeof optionalBoolean>
		: null;
};

// Vue needs every prop named at runtime, and the core table says which are booleans (G3.13).
// Functions, since the component above declares its props before a module constant here exists.
function declarations(): Declarations {
	const props: Record<string, ReturnType<typeof optionalBoolean> | null> = {};
	for (const key of VUE_ONLY_KEYS) props[key] = null;
	for (const key of OPTION_KEYS) {
		props[key] = 'boolean' in EDITOR_OPTION_SPECS[key] ? optionalBoolean() : null;
	}
	return props as Declarations;
}

/** The editor's options from the props. Vue hands a value held in `ref` or `reactive` over as a
 *  proxy, and the editor gets the object it wraps (G1.97). */
function editorOptions(props: AragoniteProps, header: HTMLElement | null): CreateEditorOptions {
	const options: Record<string, unknown> = {};
	for (const key of OPTION_KEYS) options[key] = toRaw(props[key]);
	options.plugins = rawPlugins(props.plugins);
	// An unbound `modelValue` is `undefined`, which the editor reads as no new document.
	options.source = props.modelValue;
	options.header = header;
	return options;
}

// The editor keeps a plugin by identity, and a list built from reactive state (`held.filter(...)`,
// `[{ plugin: store.plugin }]`) holds a proxy in each entry even when the list itself is plain.
function rawPlugins(entries: PluginsProp | undefined): PluginsProp | undefined {
	return toRaw(entries)?.map((entry) => {
		const raw = toRaw(entry);
		if (typeof raw === 'function' || !('plugin' in raw)) return raw;
		const plugin = toRaw(raw.plugin);
		return 'options' in raw ? { plugin, options: toRaw(raw.options) } : { plugin };
	});
}

// The declared props are exactly the component's, and no editor option hides behind a Vue-only
// name or an attribute Vue keeps for itself (G3.13).
type Holds<T extends true> = T;
type Never<T> = [T] extends [never] ? true : false;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type _PropsCheck = [
	Holds<Same<OptionKey | (typeof VUE_ONLY_KEYS)[number], keyof AragoniteProps>>,
	Holds<
		Never<
			Extract<
				keyof CreateEditorOptions,
				(typeof VUE_ONLY_KEYS)[number] | 'class' | 'style' | 'key' | 'ref'
			>
		>
	>
];
