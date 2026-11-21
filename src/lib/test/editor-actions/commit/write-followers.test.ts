// The kept starts tell every follower of each write: one that lets go while it hears a write
// leaves the others hearing that same write, and hears no write after.
// Miss-analysis: the only follower that lets go as it hears (a watch nobody read) was never
// mounted beside a second follower, so a list changed under the loop would have skipped one.
import { describe, expect, it } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { createKeptStarts, type WriteFollower } from '#lib/editor-actions/commit/kept-starts.js';

function follower(heard: string[], name: string, onHeard?: () => void): WriteFollower {
	return {
		heard() {
			heard.push(name);
			onHeard?.();
		},
		readsBefore: () => false
	};
}

describe('the followers of the kept starts', () => {
	it('all hear a write one of them lets go in, and the one that let go hears no more', () => {
		const doc = parse('one\n\ntwo\n');
		const starts = createKeptStarts(
			() => doc,
			() => {},
			() => {}
		);
		const heard: string[] = [];
		const write = () => starts.duringWrite(() => ({ touched: () => null }));
		const letGo: (() => void)[] = [];
		letGo.push(starts.follow(follower(heard, 'first', () => letGo[0]())));
		starts.follow(follower(heard, 'second'));
		starts.follow(follower(heard, 'third'));
		write();
		write();
		expect(heard).toEqual(['first', 'second', 'third', 'second', 'third']);
	});
});
