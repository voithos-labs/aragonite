import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import {
	registerBlockOpener,
	type BlockOpenerResult,
	type OpenContext
} from '../../schema/block-openers';
import { declarePluginKind } from '../../schema/plugin-kind';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';
import { configureEditorEnv, resetEditorEnv } from '../../env';
import type { Document } from '../../core/nodes';

// Drives the parser's DEV trust checks without a real misbehaving plugin. The kind name is
// decoupled from the sentinel because kind names may not contain the sentinel's symbols.
function registerSyntheticOpener(
	kindName: string,
	sentinel: string,
	build: (ctx: OpenContext, kind: ReturnType<typeof declarePluginKind>) => BlockOpenerResult
): void {
	const kind = declarePluginKind(kindName);
	registerBlockOpener(kind, {
		priority: 1,
		interruptsParagraph: false,
		tryOpen: (ctx) => (ctx.line.text.startsWith(sentinel) ? build(ctx, kind) : null)
	});
}

describe('parser opener trust guards', () => {
	beforeEach(() => __resetSchemaRegistriesForTests());
	afterEach(() => resetEditorEnv());

	// Two consecutive stuck dispatches, not one: the second proves the loop still terminates
	// when every dispatch declines, the shape that hangs a tab without the decline.
	it('declines a non-advancing opener instead of spinning the parse loop', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		configureEditorEnv({ isDev: true, isTest: false });
		registerSyntheticOpener('synthetic-stuck', '@@stuck@@', (ctx, kind) => ({
			node: { kind, leadingTrivia: ctx.leadingTrivia, raw: ctx.line.raw },
			consumed: 0 // claims no line — would spin the parse loop forever
		}));

		const source = '@@stuck@@\n\n@@stuck@@\n';
		let doc!: Document;
		expect(() => {
			doc = parse(source);
		}).not.toThrow();

		expect(doc.children.map((c) => c.kind)).toEqual(['paragraph', 'paragraph']);
		expect(serialize(doc)).toBe(source);
		expect(warnSpy).toHaveBeenCalledTimes(2);
		expect(warnSpy.mock.calls[0][0]).toMatch(/invariant:opener-advance/);
		expect(warnSpy.mock.calls[0][0]).toMatch(/synthetic-stuck/);
		expect(warnSpy.mock.calls[0][0]).toMatch(/declined/);
		warnSpy.mockRestore();
	});

	it('dev-warns, naming the kind, when raw does not byte-match the consumed lines', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		configureEditorEnv({ isDev: true, isTest: false });
		registerSyntheticOpener('synthetic-drift', '@@drift@@', (ctx, kind) => ({
			node: { kind, leadingTrivia: ctx.leadingTrivia, raw: 'UNRELATED\n' },
			consumed: 1
		}));

		parse('@@drift@@\n');

		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy.mock.calls[0][0]).toMatch(/invariant:opener-raw/);
		expect(warnSpy.mock.calls[0][0]).toMatch(/synthetic-drift/);
		warnSpy.mockRestore();
	});

	it('leaves a faithful opener (advances, raw matches) untouched', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		configureEditorEnv({ isDev: true, isTest: false });
		registerSyntheticOpener('synthetic-good', '@@good@@', (ctx, kind) => ({
			node: { kind, leadingTrivia: ctx.leadingTrivia, raw: ctx.line.raw },
			consumed: 1
		}));

		const doc = parse('@@good@@\n');

		expect(doc.children).toHaveLength(1);
		expect(doc.children[0].kind).toBe('synthetic-good');
		expect(warnSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});
});
