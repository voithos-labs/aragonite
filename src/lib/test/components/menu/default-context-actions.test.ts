// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parse } from '$lib/core/parser';
import type { NodeView } from '$lib/core/node-views';
import {
	EVERY_KIND,
	blockContextActionsFor,
	registerBlockContextActions,
	type BlockActionContext,
	type BlockContextAction
} from '$lib/schema/context-actions';
import {
	blockNoun,
	isProseBackground,
	registerDefaultContextActions
} from '$lib/components/menu/default-context-actions';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { everyInstalledPlugin } from '$lib/schema/plugin-activation';

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
		replaceRaw: async (raw: string) => void ctx.replaced.push(raw),
		transformPaste: (text: string) => text,
		lineEnding: '\n' as const
	};
	return ctx;
}

const ids = (actions: BlockContextAction[]) => actions.map((a) => a.id);
const actionsFor = (node: NodeView) => blockContextActionsFor(node, [0], everyInstalledPlugin);

describe("the noun a block's menu uses", () => {
	it('names the kind the way a user would', () => {
		expect(blockNoun(block(FENCE))).toBe('code block');
		expect(blockNoun(block('> quote\n'))).toBe('quote');
		expect(blockNoun(block('---\n'))).toBe('divider');
		expect(blockNoun(block('<div>\n</div>\n'))).toBe('HTML block');
	});

	it('calls a paragraph holding nothing but an image an image', () => {
		expect(blockNoun(block('![a](x)\n'))).toBe('image');
		expect(blockNoun(block('see ![a](x)\n'))).toBe('paragraph');
	});

	it('names a kind with no label by its kind name in words', () => {
		expect(blockNoun({ kind: 'mysteryWidget', raw: '' } as unknown as NodeView)).toBe(
			'mystery widget'
		);
	});
});

describe('prose is the page background', () => {
	it('gives prose no block menu, an image-only paragraph one', () => {
		expect(isProseBackground(block('text\n'))).toBe(true);
		expect(isProseBackground(block('# Title\n'))).toBe(true);
		expect(isProseBackground(block('![a](x)\n'))).toBe(false);
		expect(isProseBackground(block(FENCE))).toBe(false);
	});

	// Miss-analysis: every picture case held one inline image, the only shape the menu's own
	// pattern knew, while the drag handle's pattern also took several images and references.
	it('treats a paragraph of several images, or of a reference image, as a picture', () => {
		const pictures = [block('![a](x) ![b](y)\n'), block('![a][ref]\n\n[ref]: x\n')];
		for (const picture of pictures) {
			expect(isProseBackground(picture), picture.raw).toBe(false);
			expect(blockNoun(picture), picture.raw).toBe('image');
		}
	});
});

describe('the default context actions', () => {
	beforeEach(() => {
		__resetSchemaRegistriesForTests();
		registerDefaultContextActions();
	});

	it('offers copy, replace and remove, named for the block', () => {
		const actions = actionsFor(block(FENCE));
		expect(ids(actions)).toEqual(['block.copy', 'block.replace', 'block.remove']);
		expect(actions.map((a) => a.label)).toEqual([
			'Copy code block',
			'Replace with clipboard',
			'Remove code block'
		]);
	});

	it('registers once however often bootstrap asks', () => {
		registerDefaultContextActions();
		expect(ids(actionsFor(block(FENCE)))).toHaveLength(3);
	});

	it("puts a kind's own actions ahead of the defaults, and refuses a taken provider name", () => {
		const run = vi.fn();
		const provider = () => [{ id: 'fence.run', label: 'Run', run }];
		registerBlockContextActions('fencedCode', 'runner', provider);
		expect(() => registerBlockContextActions('fencedCode', 'runner', provider)).toThrow(
			/already registered/
		);
		registerBlockContextActions(EVERY_KIND, 'tagger', () => [{ id: 'any.tag', label: 'Tag', run }]);
		expect(ids(actionsFor(block(FENCE)))).toEqual([
			'fence.run',
			'block.copy',
			'block.replace',
			'block.remove',
			'any.tag'
		]);
		expect(ids(actionsFor(block('---\n')))).toEqual([
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
		const [copy, replace, remove] = actionsFor(node);
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
		await actionsFor(node)[1].run(ctx);
		expect(ctx.replaced).toEqual(['plain\n']);
		clipboard('   ');
		await actionsFor(node)[1].run(ctx);
		expect(ctx.replaced).toEqual(['plain\n']);
	});
});
