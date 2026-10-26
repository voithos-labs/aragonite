# Group 3: compile time

The words this catalog leans on, and what the enforcement levels mean, are in [the index](../invariants.md).

The strongest level: the violation doesn't compile. Enforced by `npm run check`. Each entry says
what the type retired.

| ID    | What no longer compiles                                                              | Codes |
| ----- | ------------------------------------------------------------------------------------ | ----- |
| G3.1  | An untyped metadata access (`as` cast) on a block node                               | T     |
| G3.2  | A component publishing anything but the three allowed export shapes                  | T     |
| G3.3  | A cell selection point where a character point belongs, or the reverse               | T     |
| G3.4  | A magic number standing in for "end of block"                                        | T     |
| G3.5  | A container without a declared contract                                              | T     |
| G3.6  | A container registration missing its rebuild, or a leaf claiming container fields    | T     |
| G3.7  | Arithmetic across two different coordinate spaces                                    | T     |
| G3.8  | A reader writing a node's serialized bytes                                           | T     |
| G3.9  | Forgetting one part of what the caret means without the others                       | T     |
| G3.10 | A registration pairing fields that can't mean anything together                      | T     |
| G3.11 | An editor option with no timing or boolean mark, or one `<Editor>` never names       | T     |
| G3.12 | A React wrapper prop that isn't an editor option, or hides one                       | T     |
| G3.13 | A Vue wrapper prop that isn't an editor option, or a boolean Vue would read as false | T     |
| G3.14 | A Svelte view whose component wants a prop its slot never passes                     | T     |
| G3.15 | A block kind registered without the view that draws it                               | T     |
| G3.18 | A block member with no word on who supplies it for a DOM block view                  | T     |

### The entries

**G3.1 · Typed per-kind metadata.** `BlockMetadataByKind` plus `metadataOf<K>`. Retired: `as`
metadata casts.

**G3.2 · Allowed component exports.** `svelteBlockView`, whose exports parameter is the
three allowed publication shapes (`BlockComponentExports`): a hand-built leaf's own members, a
factory-built leaf's single `blockApi`, or a container's single `containerApi`. Retired: `as unknown
as` casts, and a component that publishes nothing at all. A factory-built leaf that copies its
members out flat still compiles, since the copy is a hand-built leaf's shape; G4.73 holds that.

**G3.3 · Discriminated selection points.** `SelectionPoint` is a discriminated union
(`CharSelectionPoint | CellSelectionPoint`) on `cellCoordinate`: a cell point needs the literal
`true`, and a char-typed slot rejects a cell point. Retired: the optional-boolean flag's
construction and assignment ambiguity. `offset` keeps its name, so a wrong-space READ narrows to the
`charOffsetOf`/`cellIndexOf` runtime backstop rather than to the compiler.

**G3.4 · Branded end markers.** Branded `CURSOR_END` and `SELECTION_END`. Retired: the `999999`
magic number.

**G3.5 · Declared container contracts.** `containerContract: 'strip' | 'grid' | 'opaque'`. Retired:
the implicit table exemption.

**G3.6 · The container registration group.** `BlockKindRegistration`'s `container` group:
container-only fields register as one unit with `contract` and `rebuildRaw` required and
`isContainer` derived; a leaf augment carrying a `container` group throws. Retired: G1.3, the
runtime pairing guard.

**G3.7 · Branded coordinate spaces.** `core/coordinate-spaces.ts`: `RawOffset`, `DomTextOffset`,
`EditorX`, `ViewportX`, `CellIndex`, `DocPath`, each created only at its home module with named
conversions per direction. Public entries keep `number` and brand once at the boundary. Cross-space
arithmetic is a type error. Retired: offset-space mixing; `charOffsetOf`'s read-space check narrows
to the runtime backstop.

**G3.8 · Bytes-readonly node views.** `core/node-views.ts :: NodeView` and `DocumentView`:
serialized bytes deep-readonly, the `childIds`/`childSpans`/`markerWidths`/`ownerEpoch` bookkeeping writable. This
is G1.9 as a type: readers hold views, constructors and writers keep `CstNode`, and copying the path
(`tree-operations/unshare.ts`) is the only way back to mutable (G4.13 scans for the casts). Retired:
reader-side byte writes.

**G3.9 · One caret memory.** `src/lib/caret/caret-memory.ts` :: `createCaretMemory` holds the
sticky column, the edge record and the pending marks. A keydown updates them through `noteKey`,
and every other caret move (a click, a paste, an undo, a swap, a blur, a mode switch, a restore)
calls `forget`, which drops all three. There's no method that forgets one alone, so clearing the
column and leaving the side behind doesn't compile. Retired: G4.31's reset half and G2.10's
capture-without-reset pairing.

**G3.10 · Coherent registration pairs.** A `BlockKindRegistration` with `blockFocus: 'whole-block'`
takes no inline content, `contentStart` or title row; any other is a leaf or a container whose
children hold the text. `contentStart` pairs a content range with its Backspace, a title-row
container declares only its middle-child unwrap, and a `contextDependentKind` takes no `opener`.
Plain JS meets runtime throws (`INCOHERENT_REGISTRATION_PAIRS`, `FIXED_AT_REGISTRATION`).
`descriptor-groups.types.test.ts` pins each pair, `registration-pairs.test.ts` the table.

**G3.11 · Every option has a spec.** `EDITOR_OPTION_SPECS` gives each editor option, `header`
included, a timing (`live`, or `once`: read at mount) and marks the booleans; typed against
`EditorOptions` plus `header`, a missing, stray or mismarked row doesn't compile, and neither does
an option `Editor.svelte`'s `$props()` destructure leaves unnamed. `createEditor` skips the `once`
keys on `update`, the Vue wrapper declares props from it (G3.13), and the consumer guide's Props
section lists the split. Pins in `create-editor.test.ts :: compileTimePins`.

**G3.12 · The React props are the editor's options.** `AragoniteProps` in `packages/react` is
`CreateEditorOptions` with `source` swapped for `value`, plus the props only React has (`value`,
`defaultValue`, `onChange`, `className`, `style`). A type pin at the bottom of
`packages/react/src/aragonite.tsx` fails to compile when any other prop appears, or when an editor
option takes one of those React names, and the wrapper forwards every prop outside that list to
`update`. The wrapper compiles in `npm run package`, so that's the gate here, not `npm run check`.

**G3.13 · The Vue props are the editor's options.** Vue needs every prop named at runtime, so
`packages/vue/src/aragonite.ts` declares them from `EDITOR_OPTION_SPECS` (all but `source` and
`header`, which arrive as `modelValue` and a slot), with `default: undefined` on each boolean, since
Vue reads an absent `Boolean` as `false`. Type pins fail when the keys and `AragoniteProps` differ,
or an option takes a Vue-only name, `class`, `style`, `key` or `ref`. `vue.spec.ts` holds the
runtime half: absent keeps the default, a bare attribute reads `true`.

**G3.14 · A Svelte view fits its slot.** `svelte-view.svelte.ts :: svelteView` takes its props type
from the component, so `view: svelteView(C)` compiles in any slot whose props cover what `C`
declares and fails where `C` asks for one the slot never passes.
`src/lib/test/plugins/view/svelte-view.types.test.ts` holds the `@ts-expect-error`s.

**G3.15 · A kind comes with its view.** `BlockKindRegistration` requires `view`; only a built-in may
use the viewless `registerBuiltinBlockKind`, and built-ins get views through `attachBuiltinViews`,
typed over every kind BlockHost mounts, so one missing from `built-in-blocks.ts` fails to compile.
For a cast or plain JS, `registerBlockKind` refuses a missing or unbranded view and
`augmentBlockKind` any `view`. `descriptor-groups.types.test.ts`, `kind-view-registration.test.ts`,
`augment-guard.test.ts`. G1.2's and G1.18's component halves retired here.

**G3.18 · Every block member says who supplies it.** `schema/block-view.ts :: MEMBER_SOURCES` is a
`Record<keyof BlockComponent, MemberSource>`, so a member added to `BlockComponent` fails to compile
until it says who supplies it for a DOM view: a hand-built view's handle, the view's host, the leaf
or container surface, or only the editor. `HAND_BUILT_MEMBERS` and `HandBuiltBlock` read off it, so
the handle's type and the members its ref publishes can't drift apart. `block-view.types.test.ts`,
`block-view-none.test.ts`.
