import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { devWarn, setDevWarnSink, type DevWarnEntry, type DevWarnSink } from '../dev-warn';
import { configureEditorEnv } from '../env';

// The console arm is what the e2e watchers read, so it is pinned with the unit gate's sink
// detached — a registered sink takes reporting over and the console line never happens.
describe('devWarn — console arm', () => {
	let warnSpy: ReturnType<typeof vi.spyOn>;
	let gateSink: DevWarnSink | null;

	beforeEach(() => {
		gateSink = setDevWarnSink(null);
		warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => {
		warnSpy.mockRestore();
		setDevWarnSink(gateSink);
	});

	it('stays silent outside dev mode', () => {
		configureEditorEnv({ isDev: false, isTest: false });
		devWarn('tag', 'message');
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it('warns under test, so the unit gate can see every guard fire', () => {
		configureEditorEnv({ isDev: true, isTest: true });
		devWarn('tag', 'message');
		expect(warnSpy).toHaveBeenCalledWith('[aragonite:tag] message');
	});

	it('warns once with the sentinel [aragonite:tag] head in dev outside test', () => {
		configureEditorEnv({ isDev: true, isTest: false });
		devWarn('parser', 'unexpected node');
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy).toHaveBeenCalledWith('[aragonite:parser] unexpected node');
	});

	it('carries the sentinel through the invariant relay', () => {
		configureEditorEnv({ isDev: true, isTest: false });
		devWarn('invariant:stale-raw', 'a node the commit shared was written through');
		expect(warnSpy).toHaveBeenCalledWith(
			'[aragonite:invariant:stale-raw] a node the commit shared was written through'
		);
	});

	it('forwards details as the second console.warn argument', () => {
		configureEditorEnv({ isDev: true, isTest: false });
		const details = { offset: 3 };
		devWarn('cursor', 'bad offset', details);
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy).toHaveBeenCalledWith('[aragonite:cursor] bad offset', details);
	});

	it('omits the second argument when details is undefined', () => {
		configureEditorEnv({ isDev: true, isTest: false });
		devWarn('cursor', 'no details');
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy.mock.calls[0]).toHaveLength(1);
	});
});

describe('devWarn — sink arm', () => {
	let warnSpy: ReturnType<typeof vi.spyOn>;
	let gateSink: DevWarnSink | null;
	let seen: DevWarnEntry[];

	beforeEach(() => {
		seen = [];
		gateSink = setDevWarnSink((entry) => seen.push(entry));
		warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => {
		warnSpy.mockRestore();
		setDevWarnSink(gateSink);
	});

	it('hands the sink a structured entry and emits no console line', () => {
		devWarn('cursor', 'bad offset', { offset: 3 });
		expect(seen).toEqual([{ tag: 'cursor', message: 'bad offset', details: { offset: 3 } }]);
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it('stays silent outside dev mode even with a sink registered', () => {
		configureEditorEnv({ isDev: false, isTest: false });
		devWarn('tag', 'message');
		expect(seen).toEqual([]);
		expect(warnSpy).not.toHaveBeenCalled();
	});
});
