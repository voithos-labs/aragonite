/**
 * `ctx.render` for one drawn block: what a renderer makes, cached per block bytes and theme, and the
 * block's source with the error when it throws or rejects. A promise keeps what the element shows
 * until it settles.
 */

export interface RenderCacheDeps {
	theme(): string;
	bytes(): string;
	keepScroll(): () => Promise<void>;
}

type Made = Node | Promise<Node> | { failed: unknown };

export function createRenderCache(deps: RenderCacheDeps) {
	const made = new Map<string, Made>();
	// A handful of entries: a block's own bytes in each theme, and the last few edits.
	const memo = (key: string, produce: () => Made): Made => {
		const kept = made.get(key) ?? produce();
		made.delete(key);
		made.set(key, kept);
		if (made.size > 8) made.delete(made.keys().next().value!);
		return kept;
	};
	// Each element shows what its latest call asked for, so a late promise never overwrites it.
	const latest = new WeakMap<HTMLElement, string>();
	return (el: HTMLElement, produce: (theme: string) => Node | Promise<Node>): void => {
		const theme = deps.theme();
		const key = `${theme}\0${deps.bytes()}`;
		latest.set(el, key);
		const result = memo(key, () => {
			try {
				return produce(theme);
			} catch (failed) {
				return { failed };
			}
		});
		const show = (result: Made) => {
			if (latest.get(el) !== key) return;
			const restore = deps.keepScroll();
			el.replaceChildren(result instanceof Node ? result.cloneNode(true) : failure(result));
			void restore();
		};
		if (result instanceof Promise) result.then(show, (failed) => show({ failed }));
		else show(result);
	};

	function failure(result: Made): Node {
		const box = document.createElement('pre');
		box.className = 'drawn-render-failed';
		const { failed } = result as { failed: unknown };
		box.textContent = `${deps.bytes()}\n${failed instanceof Error ? failed.message : String(failed)}`;
		return box;
	}
}
