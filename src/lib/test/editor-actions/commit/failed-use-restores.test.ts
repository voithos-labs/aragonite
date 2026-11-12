// @vitest-environment jsdom
// `use` is a write: when it fails part way (a block type throws as the document is read again, a
// plugin throws as it starts, a plugin taken off throws as it cleans up), a mounted editor runs the
// list it ran, with its definitions, its grammar and what each plugin had attached, and `error`
// hears it once the list is back.
// Miss-analysis: every `use` row changed a list that worked, so none threw between the list's
// install and the last plugin's start, where the list had changed and the tree had not.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { configureEditorEnv, resetEditorEnv } from '@voithos-labs/aragonite/dev-checks';
import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';
import type { AnyBlockKind } from '#lib/core/nodes.js';
import type { EditorError } from '#lib/editor-events.js';
import { tryGetBlockKindDescriptor } from '#lib/schema/block-kind-descriptor.js';
import { definePlugin, lineBlock, type BlockType, type Editor } from '#lib/plugin.js';
import { command } from '#lib/schema/plugin-command.js';
import type { PluginList } from '#lib/schema/plugin-unit.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt,
	typeInto,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { allowDevWarns } from '#lib/test/support/warn-gate.js';

beforeAll(installLayoutStubs);
afterEach(async () => {
	resetEditorEnv();
	await destroyMountedEditors();
});

type Mounted = MountedEditor<EditorTestSurface>;

const SOURCE = 'one\n%%rule\n\n%%keep\n\n%%boom\n\ntwo\n';
const insert = { none: 'a test block type' };

/** A `%%rule` line, which ends the paragraph above it. */
const rule = () =>
	lineBlock({
		name: 'rule',
		label: 'Rule',
		match: /^%%rule$/,
		interrupts: true,
		sample: '%%rule',
		insert
	});

/** A `%%keep` line, the block type of a plugin every list here runs. */
const keep = () =>
	lineBlock({ name: 'keep', label: 'Keep', match: /^%%keep$/, sample: '%%keep', insert });

/** A `%%boom` line. */
const boom = () =>
	lineBlock({ name: 'boom', label: 'Boom', match: /^%%boom$/, sample: '%%boom', insert });

/** A block type whose opener throws on a `%%boom` line. */
const throwsOnBoom = () =>
	lineBlock({
		name: 'bang',
		label: 'Bang',
		match(line) {
			if (line === '%%boom') throw new Error('opener blew up');
			return line === '%%bang' ? { text: null } : null;
		},
		sample: '%%bang',
		insert
	});

/** A plugin value and what its `setup` has lived through in the one editor that lists it: the
 *  times it finished, and the times what it returned ran. A cleanup that throws throws once. */
interface Listed {
	name: string;
	plugin: PluginList[number];
	setups: number;
	cleanups: number;
	edits: number;
}

function listed(
	name: string,
	spec: {
		blocks?: BlockType<never>[];
		throws?: 'setup' | 'second setup' | 'cleanup';
		/** Called as the `setup` starts and as what it returned runs. */
		sees?(during: 'setup' | 'cleanup', editor: Editor): void;
	} = {}
): Listed {
	const life: Listed = { name, plugin: null as never, setups: 0, cleanups: 0, edits: 0 };
	life.plugin = definePlugin({
		name,
		version: '1.0.0',
		editor: '*',
		contributes: () => ({
			blocks: spec.blocks ?? [],
			commands: [command({ id: 'ping', title: 'Ping', run: () => {} })],
			setup(editor) {
				spec.sees?.('setup', editor);
				editor.on('edit', () => life.edits++);
				const again = spec.throws === 'second setup' && life.setups > 0;
				if (spec.throws === 'setup' || again) throw new Error(`${name} setup blew up`);
				life.setups++;
				return () => {
					spec.sees?.('cleanup', editor);
					const first = life.cleanups++ === 0;
					if (first && spec.throws === 'cleanup') throw new Error(`${name} cleanup blew up`);
				};
			}
		})
	});
	return life;
}

/** The plugin both lists of every scene hold, whose block type must keep its facts throughout. */
const staying = () => listed('use-stays', { blocks: [keep()] });

/** A block type that throws when the editor reads what it is. */
const unreadable = () =>
	new Proxy({} as BlockType<never>, {
		get() {
			throw new Error('block type blew up');
		}
	});

/** What a host can see of the list an editor runs: its names and how it reads the document. */
const standing = (m: Mounted) => ({
	plugins: [...m.instance.plugins],
	kinds: m.instance.__test.getDocument().children.map((block) => block.kind),
	source: m.source()
});

interface Scene {
	before: Listed[];
	next: Listed[];
	/** The plugins running once the call has failed, and the ones that aren't. */
	on: Listed[];
	off: Listed[];
}

const SCENES: {
	name: string;
	make(): Scene;
	error: { origin: EditorError['origin']; message: string; plugin?: string };
	/** The re-read's own throw comes back to the caller in a dev build, as a refused write's does. */
	devThrows?: true;
	/** The call fails with the document read under its list, so the document is read once more. */
	rereads?: true;
}[] = [
	{
		name: 'a block type that throws on the document as it is read again',
		make() {
			const [stays, leaving] = [staying(), listed('use-leaving', { blocks: [rule()] })];
			const joining = listed('use-joining', { blocks: [throwsOnBoom()] });
			return {
				before: [stays, leaving],
				next: [stays, joining],
				on: [stays, leaving],
				off: [joining]
			};
		},
		error: { origin: 'commit', message: 'opener blew up' },
		devThrows: true
	},
	{
		name: 'a plugin that throws as it starts, after another has started',
		make() {
			const [stays, leaving] = [staying(), listed('use-leaving', { blocks: [rule()] })];
			const first = listed('use-first', { blocks: [boom()] });
			const second = listed('use-second', { throws: 'setup' });
			return {
				before: [stays, leaving],
				next: [stays, first, second],
				on: [stays, leaving],
				off: [first, second]
			};
		},
		error: { origin: 'subscriber', message: 'use-second setup blew up', plugin: 'use-second' },
		rereads: true
	},
	{
		name: 'a plugin taken off that throws as it cleans up',
		make() {
			const [stays, leaving] = [staying(), listed('use-leaving', { blocks: [rule()] })];
			const sticky = listed('use-sticky', { throws: 'cleanup' });
			return {
				before: [stays, leaving, sticky],
				next: [stays],
				on: [stays, leaving, sticky],
				off: []
			};
		},
		error: { origin: 'subscriber', message: 'use-sticky cleanup blew up', plugin: 'use-sticky' }
	},
	{
		name: 'a list with a block type the editor cannot install',
		make() {
			const [stays, leaving] = [staying(), listed('use-leaving', { blocks: [rule()] })];
			const broken = listed('use-broken', { blocks: [unreadable()] });
			return {
				before: [stays, leaving],
				next: [stays, broken],
				on: [stays, leaving],
				off: [broken]
			};
		},
		error: { origin: 'commit', message: 'block type blew up' },
		devThrows: true
	}
];

const BUILDS = [
	{ build: 'a dev build', isDev: true },
	{ build: 'a production build', isDev: false }
];

/** An editor running `plugins`, holding a range across its blocks so a re-read has a selection to
 *  clear and announce. */
async function mountedHoldingRange(plugins: Listed[]): Promise<Mounted> {
	const m = mountEditor<EditorTestSurface>({
		source: SOURCE,
		plugins: plugins.map((each) => each.plugin)
	});
	await m.settle();
	await m.instance.setSelection({
		anchor: { path: [0], offset: 1 },
		focus: { path: [m.instance.__test.getDocument().children.length - 1], offset: 1 }
	});
	await m.settle();
	return m;
}

describe.each(BUILDS)('a `use` that fails part way, in $build', ({ isDev }) => {
	it.each(SCENES)('$name: the editor runs the list it ran', async (scene) => {
		const { before, next, on, off } = scene.make();
		const m = await mountedHoldingRange(before);
		const stood = standing(m);
		const tree = m.instance.__test.getDocument();
		const range = m.instance.getSelection();
		expect(stood.kinds).toContain('use-leaving/rule');
		const events = m.instance.getEvents();
		const errors: EditorError[] = [];
		// What each handler finds standing when it is called.
		const seen: { event: string; stood: ReturnType<typeof standing> }[] = [];
		events.on('error', (error) => {
			errors.push(error);
			seen.push({ event: 'error', stood: standing(m) });
		});
		events.on('selectionChange', () => seen.push({ event: 'selectionChange', stood: standing(m) }));
		const waiting = m.instance.edit().replace({ from: 0, to: 0 }, 'Z');
		configureEditorEnv({ isDev });

		let thrown: unknown;
		try {
			m.instance.use(next.map((each) => each.plugin));
		} catch (error) {
			thrown = error;
		}
		await m.settle();

		expect(standing(m)).toEqual(stood);
		expect(errors.map((e) => [e.origin, (e.error as Error).message, e.context?.plugin])).toEqual([
			[scene.error.origin, scene.error.message, scene.error.plugin]
		]);
		expect((thrown as Error | undefined)?.message).toBe(
			isDev && scene.devThrows ? scene.error.message : undefined
		);
		// One selection change where the document was read again, none where it never was.
		expect(seen.map((s) => s.event)).toEqual(
			scene.rereads ? ['selectionChange', 'error'] : ['error']
		);
		for (const { stood: found } of seen) expect(found).toEqual(stood);
		expect(m.instance.__test.getDocument() === tree).toBe(!scene.rereads);
		expect(m.instance.getSelection()).toEqual(scene.rereads ? null : range);

		expect(tryGetBlockKindDescriptor('use-stays/keep' as AnyBlockKind)?.isContainer).toBe(false);
		// The list's definitions answer, the refused list's don't.
		const defined = (each: Listed) => m.instance.canRunCommand(`${each.name}/ping`);
		expect([on.map(defined), off.map(defined)]).toEqual([on.map(() => true), off.map(() => false)]);
		// Each plugin of the list is attached once, and none of the refused list's is.
		expect(on.map((each) => each.setups - each.cleanups)).toEqual(on.map(() => 1));
		expect(off.map((each) => each.setups - each.cleanups)).toEqual(off.map(() => 0));
		const heard = [...on, ...off].map((each) => each.edits);
		const last = surfaceAt(m, [stood.kinds.length - 1]);
		typeInto(last, last.textContent + 'x');
		await m.settle();
		expect(m.source()).toBe(SOURCE.replace('two', 'twox'));
		expect([...on, ...off].map((each) => each.edits)).toEqual([
			...on.map((_, i) => heard[i] + 1),
			...off.map((_, i) => heard[on.length + i])
		]);
		// A host's edit opened ahead of the call still lands on its bytes.
		expect(await waiting.commit()).toEqual({ ok: true });
		expect(m.source()).toBe('Z' + SOURCE.replace('two', 'twox'));
		// Every hold on a block type's facts goes back with the editor, the refused list's too.
		await m.destroy();
		expect(tryGetBlockKindDescriptor('use-stays/keep' as AnyBlockKind)).toBeUndefined();
		// The row types into a block while the range it held still stands.
		allowDevWarns(['invariant:typed-write-outside-range']);
	});
});

describe('a `use` put back over a plugin that will not start again', () => {
	it('reports that plugin and starts the others it had detached', async () => {
		const [stays, leaving] = [staying(), listed('use-leaving', { blocks: [rule()] })];
		const once = listed('use-once', { throws: 'second setup' });
		const sticky = listed('use-sticky', { throws: 'cleanup' });
		const m = await mountedHoldingRange([stays, leaving, once, sticky]);
		const stood = standing(m);
		const errors: EditorError[] = [];
		m.instance.getEvents().on('error', (error) => errors.push(error));

		m.instance.use([stays.plugin]);
		await m.settle();

		expect(standing(m)).toEqual(stood);
		expect(errors.map((e) => (e.error as Error).message)).toEqual([
			'use-once setup blew up',
			'use-sticky cleanup blew up'
		]);
		const attached = [stays, leaving, once, sticky].map((each) => each.setups - each.cleanups);
		expect(attached).toEqual([1, 1, 0, 1]);
	});
});

describe('a `use` that fails as its second plugin starts', () => {
	// Miss-analysis: no `setup` or cleanup recorded what it found, so the steps of the call and of
	// the put-back could change places with every row green.
	it('shows each `setup` and cleanup one list, whole', async () => {
		let m: Mounted | null = null;
		const found: [string, ReturnType<typeof standing>][] = [];
		const sees = (who: string) => (during: string) =>
			void (m && found.push([`${who} ${during}`, standing(m)]));
		const stays = staying();
		const leaving = listed('use-leaving', { blocks: [rule()], sees: sees('leaving') });
		const first = listed('use-first', { blocks: [boom()], sees: sees('first') });
		const second = listed('use-second', { throws: 'setup', sees: sees('second') });
		m = await mountedHoldingRange([stays, leaving]);
		const ran = standing(m);
		m.instance.getEvents().on('error', () => {});

		m.instance.use([stays.plugin, first.plugin, second.plugin]);
		await m.settle();

		const refused = {
			plugins: ['use-stays', 'use-first', 'use-second'],
			kinds: ['paragraph', 'use-stays/keep', 'use-first/boom', 'paragraph'],
			source: SOURCE
		};
		expect(found).toEqual([
			['leaving cleanup', ran],
			['first setup', refused],
			['second setup', refused],
			['first cleanup', refused],
			['leaving setup', ran]
		]);
	});

	// Miss-analysis: every scene had one plugin throw, so none saw a second throw of the same call
	// dropped with the refused list's install reports.
	it('reports a plugin that throws as the call takes it back', async () => {
		const stays = staying();
		const first = listed('use-first', { throws: 'cleanup' });
		const second = listed('use-second', { throws: 'setup' });
		const m = await mountedHoldingRange([stays]);
		const errors: EditorError[] = [];
		m.instance.getEvents().on('error', (error) => errors.push(error));

		m.instance.use([stays.plugin, first.plugin, second.plugin]);
		await m.settle();

		expect(errors.map((e) => (e.error as Error).message)).toEqual([
			'use-first cleanup blew up',
			'use-second setup blew up'
		]);
	});

	it('reports a `use` it refused on the way, in a production build', async () => {
		const stays = staying();
		let inner: (() => void) | null = null;
		const nesting = definePlugin({
			name: 'use-nesting',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({ setup: () => void inner?.() })
		});
		const second = listed('use-second', { throws: 'setup' });
		const m = await mountedHoldingRange([stays]);
		const errors: EditorError[] = [];
		m.instance.getEvents().on('error', (error) => errors.push(error));
		inner = () => m.instance.use([]);
		configureEditorEnv({ isDev: false });

		m.instance.use([stays.plugin, nesting, second.plugin]);
		await m.settle();

		expect(errors.map((e) => (e.error as Error).message)).toEqual([
			'aragonite: `use` called while the plugin list is changing',
			'use-second setup blew up'
		]);
		expect(standing(m).plugins).toEqual(['use-stays']);
	});
});

describe('a `use` that fails in an editor mounted with no list', () => {
	// Miss-analysis: an editor with no list runs every installed plugin, and no row failed a `use`
	// that had just installed one page-wide.
	it('leaves it running the plugins it ran, not the one the call installed', async () => {
		let attached = 0;
		const late = definePlugin({
			name: 'use-late',
			setup: (ctx) =>
				ctx.onEditor(() => {
					attached++;
					return () => void attached--;
				})
		});
		const second = listed('use-second', { throws: 'setup' });
		const m = mountEditor<EditorTestSurface>({ source: 'x\n' });
		await m.settle();
		const ran = [...m.instance.plugins];
		const errors: EditorError[] = [];
		m.instance.getEvents().on('error', (error) => errors.push(error));

		m.instance.use([late, second.plugin]);
		await m.settle();

		expect(errors.map((e) => e.context?.plugin)).toEqual(['use-second']);
		expect(m.instance.plugins).toEqual(ran);
		expect(attached).toBe(0);
	});
});

describe.each(BUILDS)(
	'a `use` started while another is changing the list, in $build',
	({ isDev }) => {
		// Miss-analysis: no plugin called `use` from its own `setup`, where the outer call had installed
		// its list and not yet started every plugin.
		it('is refused, and the outer call is made whole or not at all', async () => {
			const stays = staying();
			let inner: (() => void) | null = null;
			const nesting = definePlugin({
				name: 'use-nesting',
				version: '1.0.0',
				editor: '*',
				contributes: () => ({ setup: () => void inner?.() })
			});
			const m = await mountedHoldingRange([stays]);
			const stood = standing(m);
			const errors: EditorError[] = [];
			m.instance.getEvents().on('error', (error) => errors.push(error));
			inner = () => m.instance.use([]);
			configureEditorEnv({ isDev });

			m.instance.use([stays.plugin, nesting]);
			await m.settle();

			const refusal = 'aragonite: `use` called while the plugin list is changing';
			// A dev build throws into the `setup` that called, so the outer call fails naming its plugin.
			expect(errors.map((e) => [(e.error as Error).message, e.context?.plugin])).toEqual([
				[refusal, isDev ? 'use-nesting' : undefined]
			]);
			expect(standing(m).plugins).toEqual(isDev ? stood.plugins : ['use-stays', 'use-nesting']);
			expect(stays.setups - stays.cleanups).toBe(1);
		});
	}
);

describe('a `use` whose list works', () => {
	it('is heard once, with the new list standing', async () => {
		const [stays, leaving] = [staying(), listed('use-leaving', { blocks: [rule()] })];
		const joining = listed('use-joining', { blocks: [boom()] });
		const m = await mountedHoldingRange([stays, leaving]);
		const seen: ReturnType<typeof standing>[] = [];
		m.instance.getEvents().on('selectionChange', () => seen.push(standing(m)));

		m.instance.use([stays.plugin, joining.plugin]);
		await m.settle();

		expect(seen).toEqual([standing(m)]);
		expect(standing(m).kinds).toEqual([
			'paragraph',
			'use-stays/keep',
			'use-joining/boom',
			'paragraph'
		]);
		expect([stays, leaving, joining].map((each) => each.setups - each.cleanups)).toEqual([1, 0, 1]);
	});

	// Miss-analysis: no cleanup read its editor or wrote, so a plugin turned off ahead of its own
	// cleanup, whose edit is then refused, changed no row.
	it('cleans a plugin up while it is still on, so its edit lands', async () => {
		const stays = staying();
		let found: readonly string[] = [];
		let landed: unknown;
		const leaving = listed('use-leaving', {
			blocks: [rule()],
			sees(during, editor) {
				if (during !== 'cleanup') return;
				found = [...editor.plugins];
				const write = editor.edit().replace({ from: 0, to: 0 }, 'Z').commit();
				void write.then((result) => (landed = result));
			}
		});
		const m = await mountedHoldingRange([stays, leaving]);

		m.instance.use([stays.plugin]);
		await m.settle();

		expect(found).toEqual(['use-stays', 'use-leaving']);
		expect(landed).toEqual({ ok: true });
		expect(standing(m)).toEqual({
			plugins: ['use-stays'],
			kinds: ['paragraph', 'use-stays/keep', 'paragraph', 'paragraph'],
			source: 'Z' + SOURCE
		});
	});

	// Miss-analysis: no handler of the selection change a `use` announces called `use`, which the
	// call still counted as inside itself.
	it.each(BUILDS)('lets the selection change it announces start another, in $build', async (b) => {
		const [stays, joining] = [staying(), listed('use-joining', { blocks: [boom()] })];
		const m = await mountedHoldingRange([stays]);
		const errors: EditorError[] = [];
		m.instance.getEvents().on('error', (error) => errors.push(error));
		let next: PluginList | null = [stays.plugin];
		m.instance.getEvents().on('selectionChange', () => {
			const list = next;
			next = null;
			if (list) m.instance.use(list);
		});
		configureEditorEnv({ isDev: b.isDev });

		m.instance.use([stays.plugin, joining.plugin]);
		await m.settle();

		expect(errors).toEqual([]);
		expect(standing(m).plugins).toEqual(['use-stays']);
		expect([stays, joining].map((each) => each.setups - each.cleanups)).toEqual([1, 0]);
	});
});
