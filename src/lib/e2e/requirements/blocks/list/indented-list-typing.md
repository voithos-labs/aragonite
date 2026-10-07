# Feature: typing in an indented list

A list can start up to three spaces in. Typing in one of its items leaves that indent where it was, so every item stays a sibling.

## Happy paths

- `  - a\n  - b\n`, click `a`, End, type `Q`: the source is `  - aQ\n  - b\n`, the list still holds two items, and the source reloads as the tree the editor holds

- `  - a\n  - b\n`, click `a`, End, Enter, type `x`: the new item sits at the same indent, `  - a\n  - x\n  - b\n`, three sibling items (regression: `- x`, and a reload nested `b` under it; miss-analysis: every Enter row split a list at column zero)

## Edge cases

- The same keys in live mode: the same sources and the same items

## Miss-analysis

- Typing in the first item wrote `- aQ`, which nests `  - b` under it on reload, and no check fired: every list fixture started at column zero, and the keystroke ran no read-back check.
