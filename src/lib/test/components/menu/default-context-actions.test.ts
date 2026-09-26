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
	registerDefaultContextActions
} from '$lib/components/menu/default-context-actions';
import { isProseLeaf } from '$lib/schema/page-role';
import { buildLinkReferenceMap } from '$lib/core/inline/link-reference-resolver';
import { fixtureReading } from '$lib/test/harness/fixture-grammar';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { everyInstalledPlugin } from '$lib/schema/plugin-activation';

const block = (md: string): NodeView => parse(md).children[0];
// The document's own link definitions, as the editor's reading carries them.
const readingOf = (md: string) => {
	const refs = buildLinkReferenceMap(parse(md).children);
	return fixtureReading({ resolver: refs.resolve, resolverSignature: refs.signature });
};
const noun = (md: string) => blockNoun(block(md), readingOf(md));
const isProse = (md: string) => isProseLeaf(block(md), readingOf(md));
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
const actionsFor = (node: NodeView) =>
	blockContextActionsFor(node, [0], everyInstalledPlugin, blockNoun(node, fixtureReading()));

describe("the noun a block's menu uses", () => {
	it('names the kind the way a user would', () => {
		expect(noun(FENCE)).toBe('code block');
		expect(noun('> quote\n')).toBe('quote');
		expect(noun('---\n')).toBe('divider');
		expect(noun('<div>\n</div>\n')).toBe('HTML block');
	});

	it('calls a paragraph holding nothing but an image an image', () => {
		expect(noun('![a](x)\n')).toBe('image');
		expect(noun('see ![a](x)\n')).toBe('paragraph');
	});

	it('names a kind with no label by its kind name in words', () => {
		const mystery = { kind: 'mysteryWidget', raw: '' } as unknown as NodeView;
		expect(blockNoun(mystery, fixtureReading())).toBe('mystery widget');
	});
});

describe('prose is the page background', () => {
	it('gives prose no block menu, an image-only paragraph one', () => {
		expect(isProse('text\n')).toBe(true);
		expect(isProse('# Title\n')).toBe(true);
		expect(isProse('![a](x)\n')).toBe(false);
		expect(isProse(FENCE)).toBe(false);
	});

	// Miss-analysis: every picture case held one inline image, the only shape the menu's own
	// pattern knew, while the drag handle's pattern also took several images and references.
	it('treats a paragraph of several images, or of a reference image, as a picture', () => {
		for (const picture of ['![a](x) ![b](y)\n', '![a][ref]\n\n[ref]: x\n', '[![a](x)](y)\n']) {
			expect(isProse(picture), picture).toBe(false);
			expect(noun(picture), picture).toBe('image');
		}
	});

	// A reference with no definition renders as its text, so it reads as prose.
	it('treats a reference image with no definition as prose', () => {
		expect(isProse('![a][nowhere]\n')).toBe(true);
		expect(noun('![a][nowhere]\n')).toBe('paragraph');
	});

	// A right-click on a quote's own bar is aimed at the quote, not at its text.
	it('gives a prose container its block menu', () => {
		expect(isProse('> quote\n')).toBe(false);
		expect(isProse('- item\n')).toBe(false);
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
