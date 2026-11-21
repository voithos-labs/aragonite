<!--
  A block drawn by a DOM view: builds the container surface its children mount through, makes the
  element the view fills, and mounts the view into it. A throw in the view's `mount` or `update`
  reaches BlockHost's error boundary, as a Svelte block's does.
-->
<script lang="ts">
	import { getAllContexts, getContext, mount, unmount, untrack } from 'svelte';
	import { on } from 'svelte/events';
	import type { BlockComponent } from '../../block-component';
	import type { NodeView } from '../../core/node-views';
	import type {
		BlockViewContext,
		BlockViewHandle,
		CommandHooksSurface,
		BlockViewSpec,
		BlockViewState,
		ContainerSurface
	} from '../../schema/block-view';
	import { componentPluginEditor } from '../../schema/block-kind-plugin';
	import { tryGetBlockKindDescriptor } from '../../schema/block-kind-descriptor';
	import {
		EDITOR_DOC_KEY,
		EDITOR_POLICIES_KEY,
		EDITOR_SERVICES_KEY,
		type EditorDoc,
		type EditorPolicies,
		type EditorServices
	} from '../../editor-keys';
	import { assertInvariant } from '@voithos-labs/aragonite/dev-checks';
	import { checkDomViewContent } from '../../invariants/dom-view-content';
	import { warnIfForeignRuntime } from '../../foreign-runtime';
	import { createContainerBlock } from '../../editor-actions/plugin/container';
	import BlockList from '../BlockList.svelte';

	let {
		spec,
		node,
		index,
		myPath
	}: { spec: BlockViewSpec; node: NodeView; index: number; myPath: number[] } = $props();

	// Read once: DomBlockHost keys this component on its spec.
	const view = untrack(() => spec);
	const editorDoc = getContext<EditorDoc>(EDITOR_DOC_KEY);
	const policies = getContext<EditorPolicies>(EDITOR_POLICIES_KEY);
	const services = getContext<EditorServices | undefined>(EDITOR_SERVICES_KEY);
	const events = services?.events;

	let childBox: HTMLElement | undefined = $state();
	let generation = $state(0);
	let handle: BlockViewHandle | null = null;
	// The box the whole-block editing host lives in, so it is read through `$state`.
	let mountedTarget: HTMLElement | null = $state(null);
	let focusEl: HTMLElement | null = null;
	let commandHooks: unknown;

	// The kind's declaration decides whole-block focus; the view only supplies the element.
	const wholeBlock =
		tryGetBlockKindDescriptor(untrack(() => node.kind))?.blockFocus === 'whole-block';
	const blockDeps = {
		getNode: () => node,
		getIndex: () => index,
		getPath: () => myPath,
		commandHooks: () => commandHooks
	};
	const container = createContainerBlock({
		...blockDeps,
		getBoxEl: () => childBox ?? mountedTarget ?? undefined,
		getFocusEl: wholeBlock ? () => focusEl : undefined,
		getAmbientPrefix: view.ambientPrefix
			? () => view.ambientPrefix!(currentState(), editorContext())
			: undefined
	});
	// Read after the container factory, which sets the children's windowing context.
	const contexts = getAllContexts();

	export function viewRef(): BlockComponent | undefined {
		return container.containerApi;
	}

	function report(error: unknown): void {
		warnIfForeignRuntime(error, `block ${node.kind}`);
		events?.emit('error', { origin: 'render', error, context: { path: myPath } });
	}

	function currentState(): BlockViewState {
		return {
			node,
			path: myPath,
			presentationMode: editorDoc.reading.mode(),
			theme: policies.theme()
		};
	}

	function editorContext() {
		const editor = componentPluginEditor(editorDoc.pluginEditor, node.kind);
		if (!editor) {
			throw new Error(`a DOM block view reads \`editor\` only inside an Editor ("${node.kind}")`);
		}
		return editor;
	}

	// `editor` stays a getter, read when the view asks.
	function viewContext<T extends object>(surface: T): BlockViewContext & T {
		return Object.defineProperty({ state: currentState, ...surface }, 'editor', {
			enumerable: true,
			get: editorContext
		}) as BlockViewContext & T;
	}

	// A framework unmounts a little after `destroy`, handing things back as it goes; once a mount
	// ends, its calls that hand the editor something do nothing, so a remounted view keeps its own.
	const HAND_OVERS = new Set(['mountChildren', 'attachFocus']);
	function untilDestroyed<T extends object>(surface: T, mount: { ended: boolean }): T {
		const guarded = { ...surface } as Record<string, unknown>;
		for (const [key, call] of Object.entries(surface)) {
			if (!HAND_OVERS.has(key)) continue;
			guarded[key] = (value: unknown) => {
				if (!mount.ended) (call as (value: unknown) => void)(value);
			};
		}
		return guarded as T;
	}

	const hooksSurface: CommandHooksSurface = {
		setCommandHooks(hooks) {
			commandHooks = hooks;
		}
	};

	// ── Container surface ─────────────────────────────────────────────────────

	let children: ReturnType<typeof mount> | null = null;

	function unmountChildren(): void {
		if (children) void unmount(children);
		children = null;
		childBox = undefined;
	}

	const containerSurface: ContainerSurface = {
		mountChildren(box) {
			// The box they're already in: remounting would drop the caret and every child's state.
			if (children && box === childBox) return;
			unmountChildren();
			childBox = box;
			// Passed, never inherited: a view may mount its children from an event handler.
			children = mount(BlockList, {
				target: box,
				props: container.blockListProps,
				context: contexts
			});
		},
		updateOwnMetadata: (patch, options) => container.updateOwnMetadata(patch, options),
		moveFocusOut: (e) => container.moveFocusOut(e),
		captureScrollPosition: () => container.captureScrollPosition(),
		openDraft: (draft) => container.openDraft(draft),
		attachFocus(el) {
			if (!wholeBlock) {
				throw new TypeError(
					`attachFocus is for a kind declaring \`blockFocus: 'whole-block'\` ("${node.kind}")`
				);
			}
			focusEl = el;
		},
		...hooksSurface
	};

	// ── Mount, update, destroy ────────────────────────────────────────────────

	function mountSpec(target: HTMLElement, mount: { ended: boolean }): BlockViewHandle {
		const surface = untilDestroyed(containerSurface, mount);
		return view.mount(target, viewContext({ container: surface }));
	}

	function mountView(target: HTMLElement): () => void {
		return untrack(() => {
			const mount = { ended: false };
			// On the block's element, so the keys of a whole-block view's own focus element reach it too.
			const offKeys = on(target, 'keydown', container.handleKeydown);
			handle = mountSpec(target, mount);
			mountedTarget = target;
			seen = watched();
			assertInvariant('dom-view-content', () => checkDomViewContent(target, null));
			return () => {
				mount.ended = true;
				offKeys();
				const ending = handle;
				handle = null;
				mountedTarget = null;
				focusEl = null;
				unmountChildren();
				try {
					ending?.destroy?.()?.catch(report);
				} catch (error) {
					report(error);
				}
			};
		});
	}

	// What an `update` follows; a container's raw changes with every edit inside it.
	function watched(): unknown[] {
		return [node.raw, myPath.join(), editorDoc.reading.mode(), policies.theme()];
	}

	let seen: unknown[] = [];
	$effect(() => {
		const now = watched();
		untrack(() => {
			if (!handle || now.every((value, i) => Object.is(value, seen[i]))) return;
			seen = now;
			if (handle.update?.(currentState()) === false) generation++;
		});
	});
</script>

{#key generation}
	<div {@attach mountView}></div>
{/key}
