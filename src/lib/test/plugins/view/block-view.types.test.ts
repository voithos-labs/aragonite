/**
 * Type pins for `defineBlockView`: it draws a container, whose `ctx` carries the container surface
 * and nothing else; a block of text or a box is a block type's `draw`. The `@ts-expect-error`
 * lines are the assertions, so `npm run check` fails if one starts compiling.
 */
import { it, expect } from 'vitest';
import { defineBlockView } from '#lib/plugin.js';

export const container = defineBlockView({
	surface: 'container',
	mount(target, ctx) {
		ctx.container.mountChildren(target);
		// @ts-expect-error a container view hands the editor nothing by hand
		void ctx.block;
		return {};
	}
});

// Never called: `defineBlockView` throws on the surface the type refuses.
export const drawnWhole = () =>
	defineBlockView({
		// @ts-expect-error a block drawn whole is a block type's `draw`, not a DOM view
		surface: 'none',
		mount: () => ({})
	});

it('compiles the pins above', () => {
	expect(container && drawnWhole).toBeTruthy();
});
