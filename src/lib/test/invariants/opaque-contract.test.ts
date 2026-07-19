import { describe, it, expect, beforeEach } from 'vitest';
import { checkStaleRaw, checkOpaqueStaleRaw } from '../../invariants/node-shape';
import { declarePluginKind } from '../../schema/plugin-kind';
import { registerBlockKind } from '../../schema/block-kind-descriptor';
import { registerBlockOpener } from '../../schema/block-openers';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';
import { testClosure } from '$lib/test/support/closure';
import { parse } from '../../core/parser';
import { concatChildren } from '../../core/serializer';
import { trimTrailingLineEnding } from '../../core/lines';
import type { AnyBlockKind, CstNode } from '../../core/nodes';

// ── Callout-shaped opaque kind with a registered opener ────────────────────
// `::note Title` carries a chrome title child at index 0, so
// `strip(raw) !== serialize(children)`. The opener accepts extra whitespace
// (`::note  Title`) and stores raw verbatim — a faithful, NON-canonical
// parse — while the rebuilder always emits a single space.

const OPEN = /^::note(?:[ \t]+(.*\S))?[ \t]*$/;
const CLOSE = /^::$/;

function rebuildNoteRaw(node: CstNode): void {
	const children = node.children ?? [];
	const title = trimTrailingLineEnding(children[0]?.raw ?? '');
	const inner =
		(node.innerPrefix ?? '') + concatChildren(children.slice(1)) + (node.innerSuffix ?? '');
	node.raw = `${title ? `::note ${title}` : '::note'}\n${inner}::\n`;
}

function registerNoteKind(opts: { declareChrome?: boolean } = {}): AnyBlockKind {
	const note = declarePluginKind('spec-note');
	const title = declarePluginKind('spec-note-title');
	registerBlockKind(title, {
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		closure: testClosure,
		contextDependentKind: true
	});
	registerBlockKind(note, {
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		closure: testClosure,
		container: {
			contract: 'opaque',
			rebuildRaw: rebuildNoteRaw,
			...(opts.declareChrome ? { reservedChrome: { kind: title } } : {})
		}
	});
	registerBlockOpener(note, {
		priority: 45,
		interruptsParagraph: false,
		tryOpen(ctx) {
			const opener = ctx.line.text.match(OPEN);
			if (!opener) return null;
			let i = ctx.index + 1;
			while (i < ctx.end && !CLOSE.test(ctx.lines[i].text)) i++;
			if (i >= ctx.end) return null;
			const body = parse(
				ctx.lines
					.slice(ctx.index + 1, i)
					.map((l) => l.raw)
					.join('')
			);
			const raw = ctx.lines
				.slice(ctx.index, i + 1)
				.map((l) => l.raw)
				.join('');
			const titleChild: CstNode = {
				kind: title,
				leadingTrivia: '',
				raw: opener[1] ? `${opener[1]}\n` : '\n'
			};
			return {
				node: {
					kind: note,
					leadingTrivia: ctx.leadingTrivia,
					raw,
					innerPrefix: body.prefix,
					children: [titleChild, ...body.children],
					innerSuffix: body.suffix
				},
				nextIndex: i + 1
			};
		}
	});
	return note;
}

function parseNote(source: string): CstNode {
	return parse(source).children[0];
}

// ── checkStaleRaw exemption ─────────────────────────────────────────────────

describe('containerContract opaque — checkStaleRaw exemption', () => {
	beforeEach(() => __resetSchemaRegistriesForTests());

	it('exempts an opaque container whose raw is not a strip of its children', () => {
		const kind = declarePluginKind('spec-opaque');
		registerBlockKind(kind, {
			mergeRole: 'container',
			editable: true,
			supportsInline: false,
			closure: testClosure,
			container: { contract: 'opaque', rebuildRaw: () => {} }
		});
		// raw deliberately diverges from serialize(children) — the opaque contract.
		const node: CstNode = {
			kind,
			leadingTrivia: '',
			raw: '::title::\nbody\n',
			children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'body\n' }]
		};
		expect(checkStaleRaw(node)).toBeNull();
	});
});

// ── checkOpaqueStaleRaw ─────────────────────────────────────────────────────

describe('checkOpaqueStaleRaw (opaque containers)', () => {
	beforeEach(() => __resetSchemaRegistriesForTests());

	// The regression pin for the byte-fixpoint false-fire: a faithful parse may
	// be non-canonical (double space stored verbatim), so raw must never be
	// byte-compared against a rebuild output.
	it('passes for a faithful non-canonical parse whose rebuild would emit different bytes', () => {
		const note = registerNoteKind();
		const node = parseNote('::note  Title\nbody\n::\n');
		expect(node.kind).toBe(note);

		const probe = { ...node };
		rebuildNoteRaw(probe);
		expect(probe.raw).not.toBe(node.raw);

		expect(checkOpaqueStaleRaw(node)).toBeNull();
	});

	it('passes after a child mutation followed by a rebuild', () => {
		registerNoteKind();
		const node = parseNote('::note Title\nbody\n::\n');
		node.children![1].raw = 'CHANGED\n';
		rebuildNoteRaw(node);
		expect(checkOpaqueStaleRaw(node)).toBeNull();
	});

	it('fires when a body child mutated without a rebuild', () => {
		registerNoteKind();
		const node = parseNote('::note Title\nbody\n::\n');
		node.children![1].raw = 'CHANGED\n';
		expect(checkOpaqueStaleRaw(node)?.code).toBe('opaque-stale-raw');
	});

	it('fires when the opener-line title chrome mutated without a rebuild', () => {
		registerNoteKind();
		const node = parseNote('::note Title\nbody\n::\n');
		node.children![0].raw = 'Renamed\n';
		expect(checkOpaqueStaleRaw(node)?.code).toBe('opaque-stale-raw');
	});

	// ── Declared reservedChrome: chrome bytes live in the opener line ────────
	// A reparse mints the chrome child BEFORE any body trivia, while the live
	// tree can legally hold an unrepresentable transient blank (the empty body
	// paragraph the Enter/descend gesture mints) AFTER it — so the chrome raw is
	// compared positionally and the body bytes as a unit, never interleaved.

	it('passes for a declared-chrome container holding a transient empty body paragraph', () => {
		registerNoteKind({ declareChrome: true });
		const node = parseNote('::note Title\n::\n');
		expect(node.children).toHaveLength(1);

		node.children!.push({ kind: 'paragraph', leadingTrivia: '', raw: '\n' });
		rebuildNoteRaw(node);
		expect(checkOpaqueStaleRaw(node)).toBeNull();
	});

	it('still fires on title-chrome drift when chrome is declared', () => {
		registerNoteKind({ declareChrome: true });
		const node = parseNote('::note Title\nbody\n::\n');
		node.children![0].raw = 'Renamed\n';
		expect(checkOpaqueStaleRaw(node)?.code).toBe('opaque-stale-raw');
	});

	it('still fires on body drift when chrome is declared', () => {
		registerNoteKind({ declareChrome: true });
		const node = parseNote('::note Title\nbody\n::\n');
		node.children![1].raw = 'CHANGED\n';
		expect(checkOpaqueStaleRaw(node)?.code).toBe('opaque-stale-raw');
	});

	// The chrome-aware comparison slices the chrome off and diffs the body bytes
	// as a unit, so a body child added or removed without a rebuild still drifts
	// the body-vs-raw byte match — the count mismatch alone must fire.
	for (const mutation of ['added', 'removed'] as const) {
		it(`fires when a body child is ${mutation} without a rebuild (chrome declared)`, () => {
			registerNoteKind({ declareChrome: true });
			const node = parseNote('::note Title\nbody\n::\n');
			if (mutation === 'added') {
				node.children!.push({ kind: 'paragraph', leadingTrivia: '', raw: 'extra\n' });
			} else {
				node.children!.pop();
			}
			expect(checkOpaqueStaleRaw(node)?.code).toBe('opaque-stale-raw');
		});
	}

	// The bail split: a kind WITH a registered opener whose raw no longer reparses
	// to that kind is genuine drift, not the openerless can't-validate case.
	it('fires when a registered-opener kind reparses to a divergent kind', () => {
		const note = registerNoteKind();
		const node = parseNote('::note Title\nbody\n::\n');
		expect(node.kind).toBe(note);
		node.raw = 'just a paragraph now\n'; // reparses to paragraph, not note
		const violation = checkOpaqueStaleRaw(node);
		expect(violation?.code).toBe('opaque-stale-raw');
		expect(violation?.detail).toMatchObject({ reason: 'reparse-diverges' });
	});

	// The check can only validate kinds whose raw reparses standalone to the
	// same kind; without a registered opener the raw reparses to a paragraph,
	// so even genuinely stale children must not fire.
	it('bails for a kind whose raw does not reparse standalone (no opener)', () => {
		const kind = declarePluginKind('spec-openerless');
		registerBlockKind(kind, {
			mergeRole: 'container',
			editable: true,
			supportsInline: false,
			closure: testClosure,
			container: { contract: 'opaque', rebuildRaw: () => {} }
		});
		const node: CstNode = {
			kind,
			leadingTrivia: '',
			raw: '::x\nbody\n::\n',
			children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'CHANGED\n' }]
		};
		expect(checkOpaqueStaleRaw(node)).toBeNull();
	});
});
