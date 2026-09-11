// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parse } from '$lib/core/parser';
import type { NodeView } from '$lib/core/node-views';
import {
	EVERY_KIND,
	blockContextActionsFor,
	registerBlockContextActions,
	__resetBlockContextActionsForTests,
	type BlockActionContext,
	type BlockContextAction
} from '$lib/schema/context-actions';
import {
	blockNoun,
	isProseBackground,
	registerDefaultContextActions,
	__resetDefaultContextActionsForTests
} from '$lib/components/menu/default-context-actions';

const block = (md: string): NodeView => parse(md).children[0];
const FENCE = '```\ncode\n```\n';

function clipboard(text: string) {
	const written: string[] = [];
	Object.defineProperty(navigator, 'clipboard', {
		value: { readText: async () => text, writeText: async (t: string) => void written.push(t) },
		configurable: true
	});
	return written;
}

function context(node: NodeView): BlockActionContext & { deleted: number; replaced: string[] } {
	const ctx = {
		node,
		path: [0],
		deleted: 0,
		replaced: [] as string[],
		deleteBlock: async () => void ctx.deleted++,
		replaceRaw: async (raw: string) => void ctx.replaced.push(raw)
	};
	return ctx;
}

const ids = (actions: BlockContextAction[]) => actions.map((a) => a.id);

describe("the noun a block's menu uses", () => {
	it('names the kind the way a user would', () => {
		expect(blockNoun(block(FENCE))).toBe('code block');
		expect(blockNoun(block('> quote\n'))).toBe('quote');
		expect(blockNoun(block('---\n'))).toBe('divider');
	});

	it('calls a paragraph holding nothing but an image an image', () => {
		expect(blockNoun(block('![a](x)\n'))).toBe('image');
		expect(blockNoun(block('see ![a](x)\n'))).toBe('paragraph');
	});

	it('falls back to "block" for a kind it has no word for', () => {
		expect(blockNoun({ kind: 'mystery', raw: '' } as unknown as NodeView)).toBe('block');
	});
});

describe('prose is the page background', () => {
	it('gives prose no block menu, an image-only paragraph one', () => {
		expect(isProseBackground(block('text\n'))).toBe(true);
		expect(isProseBackground(block('# Title\n'))).toBe(true);
		expect(isProseBackground(block('![a](x)\n'))).toBe(false);
		expect(isProseBackground(block(FENCE))).toBe(false);
	});
});

describe('the default context actions', () => {
	beforeEach(() => {
		__resetBlockContextActionsForTests();
		__resetDefaultContextActionsForTests();
		registerDefaultContextActions();
	});

	it('offers copy, replace and remove, named for the block', () => {
		const actions = blockContextActionsFor(block(FENCE), [0]);
		expect(ids(actions)).toEqual(['block.copy', 'block.replace', 'block.remove']);
		expect(actions.map((a) => a.label)).toEqual([
			'Copy code block',
			'Replace with clipboard',
			'Remove code block'
		]);
	});

	it('registers once however often bootstrap asks', () => {
		registerDefaultContextActions();
		expect(ids(blockContextActionsFor(block(FENCE), [0]))).toHaveLength(3);
	});

	it("puts a kind's own actions ahead of the defaults, and stacks repeat registrations", () => {
		const run = vi.fn();
		const provider = () => [{ id: 'fence.run', label: 'Run', run }];
		registerBlockContextActions('fencedCode', provider);
		registerBlockContextActions('fencedCode', provider);
		registerBlockContextActions(EVERY_KIND, () => [{ id: 'any.tag', label: 'Tag', run }]);
		expect(ids(blockContextActionsFor(block(FENCE), [0]))).toEqual([
			'fence.run',
			'fence.run',
			'block.copy',
			'block.replace',
			'block.remove',
			'any.tag'
		]);
		expect(ids(blockContextActionsFor(block('---\n'), [0]))).toEqual([
			'block.copy',
			'block.replace',
			'block.remove',
			'any.tag'
		]);
	});

	it('copies the block bytes, removes through the context, replaces from the clipboard', async () => {
		const written = clipboard('pasted\n');
		const node = block(FENCE);
		const ctx = context(node);
		const [copy, replace, remove] = blockContextActionsFor(node, [0]);
		await copy.run(ctx);
		expect(written).toEqual([FENCE]);
		await remove.run(ctx);
		expect(ctx.deleted).toBe(1);
		await replace.run(ctx);
		expect(ctx.replaced).toEqual(['pasted\n']);
	});

	it('terminates a replacement that arrives without its line ending, and declines a blank one', async () => {
		const node = block(FENCE);
		clipboard('plain');
		const ctx = context(node);
		await blockContextActionsFor(node, [0])[1].run(ctx);
		expect(ctx.replaced).toEqual(['plain\n']);
		clipboard('   ');
		await blockContextActionsFor(node, [0])[1].run(ctx);
		expect(ctx.replaced).toEqual(['plain\n']);
	});
});
