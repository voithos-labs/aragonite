/** What draws a block kind, opaque here so this module's types name no UI framework. Only a
 *  function that builds a view brands one, and registration refuses anything unbranded. */

const blockViewBrand: unique symbol = Symbol('BlockView');
const viewForm = Symbol('BlockView.form');

/** What draws a block kind: `textBlockView` or `svelteBlockView` (from
 *  `@voithos-labs/aragonite/svelte`) makes one. */
export interface BlockView {
	readonly [blockViewBrand]: true;
}

/** How a view draws: a Svelte component BlockHost renders inline, or a block type's `draw`, which
 *  the editor's draw host runs. */
export type BlockViewForm = 'svelte' | 'drawn';

/** Marks `body` as a block view of `form`; only the functions that build a view call it. */
export function asBlockView<T extends object>(body: T, form: BlockViewForm): T & BlockView {
	return Object.assign(body, { [blockViewBrand]: true as const, [viewForm]: form });
}

export function isBlockView(value: unknown): value is BlockView {
	return (value as Partial<BlockView> | undefined)?.[blockViewBrand] === true;
}

export function blockViewForm(view: BlockView): BlockViewForm {
	return (view as unknown as Record<typeof viewForm, BlockViewForm>)[viewForm];
}

/** The component that hosts a drawn view, which the view carries so the first load never holds it. */
export function viewHost(view: BlockView): unknown {
	return (view as unknown as { host: unknown }).host;
}
