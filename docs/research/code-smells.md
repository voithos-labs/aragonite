# Code Smells Reference

Shared vocabulary for reviews, so that "this feels wrong" can become a sentence with a name in it and stop being a matter of taste. Nothing here is an instruction to go rewrite anything.

## What is a code smell?

A **code smell** is a surface pattern in source code — naming, shape, or structure — that often points to a deeper design problem. The term was coined by Kent Beck and popularized by Martin Fowler's _Refactoring_ (1999).

Smells are **heuristics, not rules**. Spotting one is grounds for investigation, not automatic rewriting. Every entry below ends with an **Exceptions** field listing cases where the pattern is fine; read it before reaching for the refactor.

## How to read this doc

- Smells are grouped into 9 categories, each introduced with a one-line gloss of what the category covers.
- Each entry follows a fixed shape: **Description · Causation · Problem · Example · Refactoring · Exceptions**.
- Headings like `Duplicated Code / Duplicate Code` give both source names: **luzkan's name first, refactoring.guru's second**. A summary table appears at the bottom.
- The **Refactoring** line names techniques from Fowler's _Refactoring_. A definition table sits at the end of this doc — unfamiliar names link forward to it.

## Sources

- [luzkan.github.io/smells](https://luzkan.github.io/smells/) — 55 smells in 9 categories, cross-indexed by secondary classification.
- [refactoring.guru/refactoring/smells](https://refactoring.guru/refactoring/smells) — Fowler's classic 22 smells in 5 categories.

---

## Category index

| Category                   | Source | Count |
| -------------------------- | ------ | ----- |
| Bloaters                   | both   | 10    |
| Obfuscators                | luzkan | 5     |
| Lexical Abusers            | luzkan | 6     |
| Dispensables               | both   | 5     |
| Couplers                   | both   | 6     |
| Change Preventers          | both   | 7     |
| Object-Orientation Abusers | both   | 6     |
| Functional Abusers         | luzkan | 3     |
| Data Dealers               | luzkan | 6     |
| Library / Other            | both   | 1     |

---

## Bloaters

Code, classes, or methods that have grown so large they are hard to work with. Accumulated mass usually wasn't there on day one.

### Long Method

- **Description:** A single function that does too much, measured in lines or responsibilities.
- **Causation:** "While I'm here, I'll add one more thing." Easier to append than to split.
- **Problem:** Hard to read, hard to test, hard to reuse. Hides helper behaviors that should be named.
- **Example:**
  ```ts
  function renderInvoice(order) {
  	// 80 lines: totals, tax, formatting, discounts, logging, DOM writes
  }
  ```
- **Refactoring:** Extract Method; Replace Temp with Query; Decompose Conditional; Introduce Parameter Object.
- **Exceptions:** Tight inner loops where extraction would destroy locality or performance; linear setup lists with no branching.

### Large Class

- **Description:** A class trying to be responsible for too many concepts at once.
- **Causation:** Feature growth without refactoring; "god object" that became a convenient dumping ground.
- **Problem:** Loss of cohesion, duplicated state, magnetic attractor for unrelated changes.
- **Example:** A `User` class that owns auth, preferences, billing, notification, and session logic.
- **Refactoring:** Extract Class; Extract Subclass; Extract Interface; Replace Data Value with Object.
- **Exceptions:** Generated code; domain aggregates (a DDD term: composite entities fronted by a root) whose internal cohesion is genuinely high.

### Long Parameter List

- **Description:** Methods with three or more parameters (luzkan's threshold) that travel together.
- **Causation:** Avoiding a class by passing all of its would-be fields; over-configurable APIs.
- **Problem:** Call sites become positional soup; easy to swap arguments of the same type.
- **Example:** `createReservation(userId, roomId, start, end, guests, notes, discount, channel)`.
- **Refactoring:** Introduce Parameter Object; Preserve Whole Object; Replace Parameter with Method Call.
- **Exceptions:** True primitives with no natural grouping (e.g., math functions).

### Data Clump / Data Clumps

- **Description:** The same group of variables appears together across many signatures and structures.
- **Causation:** Primitives modeled before the concept they collectively represent was noticed.
- **Problem:** Changes to the clump ripple across every touchpoint; the missing type stays missing.
- **Example:** `(street, city, zip, country)` appearing in `User`, `Order`, `Shipment`, `Invoice`.
- **Refactoring:** Extract Class; Introduce Parameter Object; Preserve Whole Object.
- **Exceptions:** Clumps that appear in exactly one place may not yet justify a type.

### Primitive Obsession

- **Description:** Using primitives (string, int) to model domain concepts that deserve their own type.
- **Causation:** Speed of typing; reluctance to create "trivial" wrappers.
- **Problem:** Validation scatters; type confusion (two strings, which is the email?); invariants unenforced.
- **Example:** `function sendEmail(to: string, subject: string, body: string)` — nothing stops `sendEmail(body, subject, to)`.
- **Refactoring:** Replace Data Value with Object; Replace Type Code with Class / Subclasses / State-Strategy.
- **Exceptions:** Throwaway scripts; boundary code that truly handles opaque strings.

### Combinatorial Explosion

- **Description:** Many "almost identical" branches handling each product of a small number of axes.
- **Causation:** Adding cases one at a time instead of factoring the axes.
- **Problem:** Code size scales with the _product_ of the axes (n × m) when it should scale with their _sum_ (n + m); missing cells get noticed only in production.
- **Example:** Separate `sendSmsUrgent`, `sendSmsNormal`, `sendEmailUrgent`, `sendEmailNormal`, … one per (channel × priority) pair.
- **Refactoring:** Parameterize Method; Strategy pattern; lift axes into data-driven dispatch.
- **Exceptions:** When the axes genuinely interact — each cell has logic that can't be derived from the axis values alone, so factoring them apart would lose information.

### Null Check

- **Description:** Defensive `if (x == null)` checks scattered across the codebase.
- **Causation:** Unclear nullability contracts; unwillingness to use Option/Maybe or non-null types.
- **Problem:** Every caller reimplements absence handling; one missed check triggers a null-pointer exception (NPE).
- **Example:**
  ```ts
  if (user && user.profile && user.profile.address && user.profile.address.city) { ... }
  ```
- **Refactoring:** Introduce Null Object; use an Optional / Maybe type (a wrapper that forces callers to handle the "absent" case explicitly); make fields non-nullable and push nullability to the edge.
- **Exceptions:** External I/O boundaries where null genuinely means "not loaded" and the handling is local.
- **See also:** Special Case (the generalization of Null Object to any "default placeholder" value).

### Oddball Solution

- **Description:** The same problem solved two different ways in two places in the same codebase.
- **Causation:** Parallel development; unaware of existing helper; copy-paste with tweaks.
- **Problem:** Subtly divergent behavior, bugs fixed in one copy only, onboarding confusion.
- **Example:** One module debounces with `setTimeout`, another with a custom `Debouncer` class, both for the same purpose.
- **Refactoring:** Pick the better implementation; extract it; migrate callers; delete the loser.
- **Exceptions:** When constraints genuinely differ (e.g., one runs in a Worker), preserve both but document.

### Required Setup or Teardown Code

- **Description:** Multiple mandatory lines surround each use of a class, or every test file repeats the same scaffolding.
- **Causation:** Constructor under-does the work; resources leak without explicit cleanup.
- **Problem:** Forgetting the ritual is a bug; ritual drifts between sites.
- **Example:** `new Conn(); conn.configure(…); conn.auth(…); try { … } finally { conn.flush(); conn.close(); }`.
- **Refactoring:** Move setup into constructor / factory; tie cleanup to scope exit (C++ RAII destructors, Python `with`, C#/TS `using`, Go `defer`); extract fixtures for test setup.
- **Exceptions:** True resource lifecycles where the caller legitimately controls staging.

### Vertical Separation

- **Description:** Variables declared far from where they're first used.
- **Causation:** "Declare at top" habit from older languages; preference for visually grouped declarations.
- **Problem:** Reader must scroll to correlate declaration with use; temporaries outlive their purpose.
- **Example:** All locals declared in the first 10 lines of a 40-line method, then used scattered below.
- **Refactoring:** Inline Variable where trivial; Move Declaration Near First Use; Extract Method.
- **Exceptions:** Languages/styles that require top-of-scope declarations.

---

## Obfuscators

Code that is technically correct but opaque to the reader.

### Clever Code

- **Description:** Code written to show off or save keystrokes at the cost of clarity.
- **Causation:** Ego, terseness bias, "one-liner" reflex.
- **Problem:** Maintainers debug the cleverness before the bug.
- **Example:**
  ```ts
  return ~~(a / b) | 0; // cryptic — both `~~` (double bitwise NOT) and `| 0` coerce the float to int32
  return Math.trunc(a / b); // same result, obvious intent
  ```
- **Refactoring:** Rewrite in boring, named steps; add a brief comment only if the non-obvious trick is load-bearing.
- **Exceptions:** Genuinely hot paths where the cleverness is measurably faster and documented.

### Complicated Boolean Expression

- **Description:** `if` condition so long the reader forgets the subject before reaching the verb.
- **Causation:** Conditions grew feature by feature; nobody paused to name the pieces.
- **Problem:** Negation errors, operator-precedence bugs, impossible to test in isolation.
- **Example:** `if (a && (b || c) && !d && e !== f && g.length > 0) { … }`.
- **Refactoring:** Decompose Conditional; Extract Variable with explaining names; Replace with guard clauses.
- **Exceptions:** Short-circuiting predicates where decomposition loses performance-critical ordering.

### Complicated Regex Expression

- **Description:** Regexes that have outgrown a single line of understanding.
- **Causation:** One-off patterns accreting edge cases over time.
- **Problem:** Pathological backtracking; silent misparses; unmaintainable.
- **Example:** `/^(?:(?:[a-zA-Z0-9_\-.+]+)@(?:(?:\[?(?:(?:25[0-5]|…))\]?)|…))$/`.
- **Refactoring:** Break into labeled sub-patterns; use named groups; prefer a parser when the grammar is real.
- **Exceptions:** Validated library regexes (e.g., RFC-grade email) with strong test coverage.

### Obscured Intent

- **Description:** Code whose purpose is unclear, regardless of syntactic complexity.
- **Causation:** Missing names; domain logic hidden inside generic helpers.
- **Problem:** Readers infer intent by guessing; bugs masquerade as features.
- **Example:** `const x = arr.reduce((a, b) => a + b[2] * 0.07, 0);` — what is `0.07`? What is index 2?
- **Refactoring:** Rename variables; Introduce Explaining Variable; Extract Method named after intent.
- **Exceptions:** None — the whole point of source code is to express intent.

### Status Variable

- **Description:** A mutable flag tracking where a computation currently is.
- **Causation:** Imperative state machines written ad hoc inside one function.
- **Problem:** Reader must simulate the state machine mentally; every branch compounds the state space.
- **Example:** `let state = "idle"; … if (state === "loading") state = "done";` scattered across a method.
- **Refactoring:** Replace Control Flag with Break/Return; Extract Method; model as State pattern or explicit enum transitions.
- **Exceptions:** Small, bounded loops where the flag is local and clearly named.

---

## Lexical Abusers

Smells rooted in naming — the label on the jar doesn't match what's inside.

### Fallacious Comment

- **Description:** A comment that lies — once true, now stale.
- **Causation:** Code edited, comment forgotten.
- **Problem:** Actively misleads readers, worse than no comment at all.
- **Example:** `// returns null if not found` above a function that now throws.
- **Refactoring:** Delete or rewrite; prefer self-documenting code so there's nothing to drift.
- **Exceptions:** None — a lying comment should always be fixed immediately when noticed.

### Fallacious Method Name

- **Description:** A name that promises one thing and does another.
- **Causation:** Behavior changed; name didn't. Or the name was always misleading.
- **Problem:** Callers rely on the name, not the body; bugs follow.
- **Example:** `getUser(id)` that silently creates a user if missing.
- **Refactoring:** Rename to reflect behavior (`getOrCreateUser`) or split into two methods.
- **Exceptions:** None.

### Boolean Blindness

- **Description:** Booleans as arguments or return values where the reader can't tell what `true` means.
- **Causation:** Over-use of primitive boolean for flags and modes.
- **Problem:** `send(msg, true, false)` — no call site tells you anything.
- **Example:** `setVisibility(true)` vs `setVisibility(Visibility.Hidden)`.
- **Refactoring:** Replace with named enum; split into two methods; use a named parameter object.
- **Exceptions:** Languages that force the parameter name to appear at the call site (Swift labels, Python keyword-only arguments) — `send(msg, urgent: true)` carries its meaning.

### Inconsistent Names

- **Description:** Similar concepts named differently across similar classes or methods.
- **Causation:** Independent authorship; renaming without follow-through.
- **Problem:** Readers can't grep for a concept; API feels hostile.
- **Example:** `OrderRepo.findById`, `UserRepo.getById`, `ProductRepo.fetch`.
- **Refactoring:** Pick a convention; Rename; lint names against the convention.
- **Exceptions:** Legacy APIs that can't be broken — document the inconsistency.

### Magic Number

- **Description:** A numeric literal whose meaning isn't obvious.
- **Causation:** Value hardcoded at write time; nobody named it.
- **Problem:** Same number means different things across sites; changes miss occurrences.
- **Example:** `if (retries > 3) …` — why 3?
- **Refactoring:** Extract constant with descriptive name (`MAX_AUTH_RETRIES`).
- **Exceptions:** 0, 1, -1, 2 used in genuinely trivial ways (array indices, polarity flips).

### Uncommunicative Name

- **Description:** `data`, `info`, `temp`, `x` where a domain term exists.
- **Causation:** Haste; unfamiliarity with the domain.
- **Problem:** Reader has to trace the value to learn what it represents.
- **Example:** `const data = fetchUser(); data.name;` — why not `user`?
- **Refactoring:** Rename with intent-revealing name; let the type system help.
- **Exceptions:** Truly generic utilities (`map((x) => x + 1)`) where the identity is the point.

---

## Dispensables

Code whose removal would make the system better.

### Duplicated Code / Duplicate Code

- **Description:** The same logic in two or more places.
- **Causation:** Copy-paste; parallel work; ignorance of existing helpers.
- **Problem:** Fixes land in one copy only; behaviors silently diverge.
- **Example:** Two route handlers that re-implement the same pagination math.
- **Refactoring:** Extract Method / Function / Class; Pull Up Method; Form Template Method.
- **Exceptions:** [Rule of Three](https://wiki.c2.com/?RuleOfThree) — duplicate twice, extract on the third; two similar lines ≠ shared abstraction yet.

### Dead Code

- **Description:** Code that is unreachable or never called.
- **Causation:** Feature removed without deleting supporting code; refactor left orphans.
- **Problem:** Readers assume it still matters; keeps appearing in test/grep results.
- **Example:** A helper function with zero callers; a branch whose condition is always false.
- **Refactoring:** Delete. Version control remembers it.
- **Exceptions:** Code guarded by feature flags not yet rolled out.

### Lazy Element / Lazy Class

- **Description:** A class, method, or module whose existence doesn't earn its complexity cost.
- **Causation:** Over-anticipation; originally richer element that got whittled down.
- **Problem:** One more indirection for no benefit; cognitive tax without payoff.
- **Example:** A `StringUtils` class holding one method that just calls `.trim()`.
- **Refactoring:** Inline Class; Collapse Hierarchy; Remove Middle Man.
- **Exceptions:** Elements that stabilize an abstraction boundary and are expected to grow.

### Speculative Generality

- **Description:** Hooks, params, and abstractions added for a future that never arrived.
- **Causation:** "We might need to support X someday." Violates YAGNI ("You Aren't Gonna Need It" — the XP principle that you shouldn't build for imagined future needs).
- **Problem:** Carries cost forever; wrong guess shapes the API badly.
- **Example:** An interface with one implementation; an unused strategy parameter.
- **Refactoring:** Collapse Hierarchy; Inline Class; Remove Parameter; Rename to what it actually is.
- **Exceptions:** Public library APIs where breaking change cost justifies pre-emptive generality.

### "What" Comment / Comments

- **Description:** Comments describing what code does rather than why.
- **Causation:** Unclear code "explained" instead of rewritten.
- **Problem:** Code and comment drift; the comment fossilizes the wrong abstraction.
- **Example:** `// increment i` above `i++`.
- **Refactoring:** Delete the comment; rename or extract until the code speaks for itself. Keep only _why_ comments.
- **Exceptions:** Non-obvious constraints (workarounds, invariants, regulatory rules) that aren't derivable from the code.

---

## Couplers

Connections between classes that are too tight.

### Feature Envy

- **Description:** A method more interested in another class's data than its own.
- **Causation:** Behavior placed in the wrong class; data moved, behavior didn't follow.
- **Problem:** Breaks encapsulation; the data class and the method class change together.
- **Example:**
  ```ts
  class Invoice {
  	total(order: Order) {
  		// Every line reads from `order`, nothing from `this`.
  		const subtotal = order.items.reduce((s, i) => s + i.price * i.qty, 0);
  		return subtotal * order.taxRate + order.shippingFee;
  	}
  }
  ```
  The method belongs on `Order`.
- **Refactoring:** Move Method; Extract Method then Move; Preserve Whole Object.
- **Exceptions:** Strategy / Visitor / Specification patterns where the outside method is the point.
- **See also:** Fate over Action / Data Class — the class being envied has no behavior of its own, which is why callers reach in.

### Fate over Action / Data Class

- **Description:** Classes consisting solely of fields and getters/setters with no behavior.
- **Causation:** Anemic-domain-model style (objects hold state, external "service" code owns all behavior); OO by accident only.
- **Problem:** Logic about the data scatters across callers; invariants unenforced.
- **Example:** `class Money { value: number; currency: string; }` with arithmetic done everywhere else.
- **Refactoring:** Move Method; Encapsulate Field; Remove Setting Method once state is correct at construction.
- **Exceptions:** DTOs (data-transfer objects — plain structs crossing a process or network boundary), wire formats, and ORM (object-relational mapper) rows where behavior genuinely belongs elsewhere.
- **See also:** Feature Envy — the partner smell in surrounding code.

### Indecent Exposure

- **Description:** A class exposes internals that callers shouldn't depend on.
- **Causation:** Public-by-default habit; reluctance to think about encapsulation.
- **Problem:** Every field becomes part of the API; refactors break clients.
- **Example:** `public fields`, public mutable collections, public helper classes only the owner should use.
- **Refactoring:** Encapsulate Field; Hide Method; narrow visibility.
- **Exceptions:** Tightly-coupled internal packages where exposure is scoped.

### Afraid To Fail

- **Description:** Code wrapped in too-broad try/catch blocks that swallow or paper over errors.
- **Causation:** Fear of crashes; checklist-driven "must have error handling" without thinking.
- **Problem:** Real failures become silent; recovery code substitutes for understanding.
- **Example:** `try { doThing(); } catch { /* ignore */ }` across the codebase.
- **Refactoring:** Let errors propagate; narrow catches to specific exception types; handle only at boundaries.
- **Exceptions:** Top-level request handlers and crash reporters that legitimately need to contain failures.

### Binary Operator in Name

- **Description:** Method or function names containing `and`, `or`, bitwise / boolean operators.
- **Causation:** Method doing two things; name confesses it.
- **Problem:** Violates single-responsibility; callers rarely want both halves.
- **Example:** `validateAndSave(user)`, `getOrCreate`.
- **Refactoring:** Split into two methods; compose at the call site.
- **Exceptions:** Idiomatic pairs (`getOrDefault`) or atomic ops where separation would introduce a race.

### Type Embedded in Name

- **Description:** Variables named with a type prefix/suffix: `userList`, `nameStr`, `countInt`.
- **Causation:** Habit inherited from Hungarian notation (a Microsoft-era convention of encoding a variable's type into its name, e.g. `strName`, `iCount`); lack of trust in the type system.
- **Problem:** Type drifts (list → set) and name lies; noise without info.
- **Example:** `userList: Set<User>`.
- **Refactoring:** Rename to domain noun (`users`); let the type do its job.
- **Exceptions:** Dynamically-typed languages where the type is genuinely ambiguous and disambiguation helps.

---

## Change Preventers

Structures that make one change force many others.

### Divergent Change

- **Description:** One class changes for many unrelated reasons.
- **Causation:** Mixed responsibilities; class collects everything tangentially related.
- **Problem:** Every feature touches the same class; merge conflicts follow.
- **Example:** A `UserService` modified for auth changes, email templates, and billing tweaks.
- **Refactoring:** Extract Class along the change axes; align classes to reasons-to-change.
- **Exceptions:** Facade classes that legitimately orchestrate multiple concerns and delegate.

### Shotgun Surgery

- **Description:** The inverse of Divergent Change — one logical change requires edits in many classes.
- **Causation:** Responsibility smeared across the codebase; missing central concept.
- **Problem:** Easy to miss a spot; change cost proportional to codebase size.
- **Example:** Adding a new user role requires edits in 15 files.
- **Refactoring:** Move Method / Field; Inline Class to consolidate; introduce the missing abstraction.
- **Exceptions:** Cross-cutting concerns that genuinely live at every layer (logging, internationalization / i18n, metrics).

### Parallel Inheritance Hierarchies

- **Description:** Every subclass of A requires a matching subclass of B.
- **Causation:** Two hierarchies built around the same axis of variation.
- **Problem:** Adding a variant means creating two classes; forgetting one is a bug.
- **Example:** `Employee`/`Manager`/`Intern` each with their own `EmployeePrinter`/`ManagerPrinter`/`InternPrinter`.
- **Refactoring:** Move Method / Field to merge one hierarchy into the other; Visitor pattern.
- **Exceptions:** Genuinely parallel variation where merging would bloat a single class.

### Dubious Abstraction

- **Description:** A class or module whose abstraction degrades into a junk drawer over time.
- **Causation:** Lack of owner; members added opportunistically; no one prunes.
- **Problem:** Name implies one thing, contents reveal another; nobody trusts the interface.
- **Example:** A `Utils` module containing string helpers, date helpers, and a cache.
- **Refactoring:** Split along cohesive lines; Extract Module; Rename the remainder to its true contents.
- **Exceptions:** Small vocabulary modules (e.g., `constants.ts`) whose job is to be a dumping ground for one kind of thing.

### Flag Argument

- **Description:** A parameter that selects among behaviors inside the method.
- **Causation:** Wrote one method, added a flag rather than a second method.
- **Problem:** Body is two methods mashed together; call sites are mystery booleans.
- **Example:** `render(doc, true)` — true means what?
- **Refactoring:** Split into two explicit methods (`renderDraft`, `renderFinal`); Replace with Strategy.
- **Exceptions:** Rare cases where the flag is orthogonal post-processing and the body is genuinely shared.

### Callback Hell

- **Description:** Deeply nested callback pyramids with cascading braces.
- **Causation:** Async control flow before language-level async/await.
- **Problem:** Error handling forks at every level; reading left-to-right requires time travel.
- **Example:** `fetchA(cb1 => fetchB(cb1, cb2 => fetchC(cb2, cb3 => … )))`.
- **Refactoring:** Use `async/await` or Promises; Extract named handlers; linearize with generators.
- **Exceptions:** Event emitters where the callback nesting mirrors genuine event hierarchy.

### Special Case

- **Description:** Complex branching to handle "this one case differently."
- **Causation:** Edge cases accreted without absorbing them into the type system.
- **Problem:** Every reader must carry the edge case in their head at every call site.
- **Example:** `if (user.id === 0) { /* anonymous */ } else { /* normal */ }` scattered across the code.
- **Refactoring:** Introduce Null Object / Special Case object; polymorphism; make the special case a proper subtype.
- **Exceptions:** Genuinely one-off branches in leaf code.
- **See also:** Null Check (the most common instance of this smell).

---

## Object-Orientation Abusers

OO features used against the grain of OO design.

### Alternative Classes with Different Interfaces

- **Description:** Two classes do the same job but expose it via different method signatures.
- **Causation:** Independent invention; parallel teams.
- **Problem:** Callers can't swap them; duplication of behavior and tests.
- **Example:** `PdfExporter.toFile(path)` vs `CsvExporter.write(dest)`.
- **Refactoring:** Rename Method; Move Method; Extract Superclass or common Interface.
- **Exceptions:** Genuinely different domains that only appear similar at a superficial level.

### Refused Bequest

- **Description:** Subclass inherits methods or data it doesn't use or overrides to no-op.
- **Causation:** Inheritance chosen where composition would fit; hierarchy modeled too eagerly.
- **Problem:** Violates LSP (Liskov Substitution Principle — a subtype must be usable anywhere its parent is, without surprising behavior); readers can't trust the base contract.
- **Example:** `Square extends Rectangle`. `Rectangle`'s contract lets width and height vary independently; a `Square` has to keep them equal, so `setWidth(3)` silently changes the height too. Code written against `Rectangle` breaks when handed a `Square`.
- **Refactoring:** Replace Inheritance with Delegation; Push Down Method; restructure the hierarchy.
- **Exceptions:** Framework base classes where a few unused hooks are standard.

### Conditional Complexity / Switch Statements

- **Description:** Lengthy `switch` or cascading `if/else` dispatching on a type code.
- **Causation:** Procedural habits; type codes instead of types.
- **Problem:** Adding a new case requires editing every switch across the code.
- **Example:** `switch (shape.kind) { case 'circle': …; case 'square': …; }` in five modules.
- **Refactoring:** Replace Type Code with Subclasses / State / Strategy; Replace Conditional with Polymorphism.
- **Exceptions:** Exhaustive pattern matches the compiler checks for you — Rust `match`, TypeScript discriminated unions (union types where one field distinguishes variants). Adding a new variant surfaces every switch that needs updating.

### Temporary Field

- **Description:** An object field populated only for specific operations, otherwise null / unset.
- **Causation:** Method needed scratch state and stashed it on the class instead of a parameter.
- **Problem:** Readers can't tell when the field is valid; invariants collapse.
- **Example:** `OrderCalculator.intermediate: number | null` used only inside `calculate()`.
- **Refactoring:** Extract Class for the operation; pass the state as parameters; Introduce Null Object.
- **Exceptions:** Caches that are explicitly optional and documented as such.

### Base Class depends on Subclass

- **Description:** Parent references or imports specific children.
- **Causation:** Parent written with knowledge of existing children; circular reasoning creeps in.
- **Problem:** Can't deploy or reuse the base without its full family; violates OCP (Open-Closed Principle — types should be open for extension, closed for modification).
- **Example:** `abstract class Animal { if (this instanceof Dog) … }`.
- **Refactoring:** Replace Conditional with Polymorphism; Template Method pattern; invert dependency.
- **Exceptions:** Sealed hierarchies and algebraic data types (ADTs — types defined as a fixed set of variants, like Rust `enum` or Kotlin `sealed class`) where the parent is meant to enumerate its children.

### Inappropriate Static

- **Description:** Static method where an instance method (or free function) would fit better.
- **Causation:** Convenience; avoidance of dependency injection.
- **Problem:** Can't substitute for tests; hidden global state.
- **Example:** `UserService.current()` accessing a static `currentUser`.
- **Refactoring:** Convert to instance method; Inject dependency; make the implicit global explicit.
- **Exceptions:** Truly pure functions (`Math.max`); factory methods on the class itself.

---

## Functional Abusers

Imperative habits applied where functional discipline — immutability, purity, declarative flow — would make the code easier to reason about.

### Imperative Loops

- **Description:** Hand-rolled `for` / `while` where a declarative pipeline would be clearer.
- **Causation:** Muscle memory; unfamiliarity with `map`/`filter`/`reduce`.
- **Problem:** Obscures intent; accumulates mutable state; harder to compose.
- **Example:** `const out = []; for (let i = 0; i < xs.length; i++) if (xs[i].active) out.push(xs[i].name);`.
- **Refactoring:** Replace with `.filter().map()`; Extract Function for each step.
- **Exceptions:** Performance-critical loops where allocation matters; early termination with side effects.

### Mutable Data

- **Description:** Data mutated in place where a new immutable value would serve.
- **Causation:** Default mutability in most languages; concern for allocation cost.
- **Problem:** Aliasing bugs; time-dependent reads; concurrency hazards.
- **Example:** `user.name = newName` with the same object shared across 10 places.
- **Refactoring:** Encapsulate Variable; return new values; use immutable types / `readonly`.
- **Exceptions:** Hot loops; large data structures where copy cost dominates; clearly-scoped local mutation.

### Side Effects

- **Description:** Functions that do more than their name promises — modify globals, I/O, shared state.
- **Causation:** No distinction between commands and queries; hidden logging, metrics, caching baked into "pure" code.
- **Problem:** Hard to reason about; test order dependence; unexpected writes.
- **Example:** `function getUser(id) { metrics.increment(); return cache.set(id, fetch(id)); }`.
- **Refactoring:** Separate Query from Modifier; move effects to the edges; make commands explicit.
- **Exceptions:** Builders and fluent APIs where mutation is the documented point.

---

## Data Dealers

Smells about how code shuttles data around — who reaches for what, through how many hops, and whether the trade is above-board.

### Global Data

- **Description:** State reachable from anywhere, modifiable by anyone.
- **Causation:** Expediency; wanting to "just share this one thing."
- **Problem:** Invisible coupling; test order dependency; concurrency nightmare.
- **Example:** `window.currentUser = …` set in one place and read in fifty.
- **Refactoring:** Encapsulate Variable; pass explicitly; Dependency Injection.
- **Exceptions:** Truly app-wide singletons (logger, clock) where injection cost outweighs benefit — but test seams matter.

### Hidden Dependencies

- **Description:** A method silently reaches out to resolve what it needs — service locator, static lookup, import side effects.
- **Causation:** DI felt heavy; direct access felt cheap.
- **Problem:** Signature lies; tests need invisible setup; reuse impossible.
- **Example:** `class Billing { charge() { DB.shared().query(…); } }`.
- **Refactoring:** Introduce parameter / constructor injection; invert the dependency.
- **Exceptions:** Infrastructure seams with explicit ambient contexts (React context, request-scoped loggers).

### Insider Trading / Inappropriate Intimacy

- **Description:** Two classes reach into each other's private parts.
- **Causation:** Classes extracted from a single blob that still shares too much.
- **Problem:** Can't evolve either independently; change in one cracks the other.
- **Example:** `Order` mutates `Customer.creditUsed` directly.
- **Refactoring:** Move Method / Field; Extract Class; Hide Delegate; narrow the interface.
- **Exceptions:** Tightly-coupled friend classes whose intimacy is intentional (iterators and their containers).
- **See also:** Message Chain — both break the Law of Demeter, just in different directions.

### Message Chain

> Placement note: luzkan files this under Data Dealers (it's about data routing); refactoring.guru files it under Couplers (it's about class coupling). Same smell, same fix.

- **Description:** A sequence of `a.b().c().d().e()` calls to reach what you need.
- **Causation:** Callers navigating object structure to pluck out fields.
- **Problem:** Every link couples the caller to the whole chain's shape.
- **Example:** `user.getProfile().getAddress().getCity().getName()`.
- **Refactoring:** Hide Delegate; Extract Method on the entry object. Follows the Law of Demeter ("only talk to your immediate neighbors" — an object should call methods on itself, its fields, its parameters, or objects it creates, never on the results of _other_ method calls).
- **Exceptions:** Fluent builder APIs where the chain is the point.
- **See also:** Middle Man (the opposite extreme — hiding a delegate so aggressively the wrapper becomes useless); Insider Trading (also a Law of Demeter violation).

### Middle Man

> Placement note: filed under Data Dealers here (luzkan); refactoring.guru lists it under Couplers.

- **Description:** A class whose methods only delegate to another class.
- **Causation:** Delegation added defensively; original purpose hollowed out over time.
- **Problem:** Layer that adds nothing but changes to propagate.
- **Example:** `UserService.getName(id)` → `UserRepo.getName(id)` → `UserDb.name(id)`.
- **Refactoring:** Remove Middle Man; talk to the delegate directly; Inline.
- **Exceptions:** Anti-corruption layers and adapters that legitimately translate between boundaries.
- **See also:** Message Chain — the opposite extreme. Fixing one can induce the other, so stop when hops are short _and_ each layer adds value.

### Tramp Data

- **Description:** A value threaded through many layers just to reach a deep function.
- **Causation:** Deep call stacks; reluctance to use context / DI.
- **Problem:** Every intermediate signature changes when the deep function's needs change.
- **Example:** `render(user)` → `renderHeader(user)` → `renderNav(user)` → `renderAvatar(user)` where only the last uses `user`.
- **Refactoring:** Introduce context object; use ambient context (React Context, thread-local); reorganize ownership.
- **Exceptions:** Short chains (2-3 levels) where explicit passing aids readability.

---

## Library / Other

Smells rooted outside your own code — you own the caller, someone else owns the class.

### Incomplete Library Class

- **Description:** A third-party class almost does what you need but leaves a crucial capability out.
- **Causation:** Library author's scope differs from yours.
- **Problem:** Temptation to fork, subclass awkwardly, or scatter workarounds.
- **Example:** `DateTime` lacks the formatting option you need, so each caller post-processes the output.
- **Refactoring:** Introduce Foreign Method (free function that operates on the library type); Introduce Local Extension (subclass or wrapper class); upstream a PR.
- **Exceptions:** None — wrap rather than monkey-patch (dynamically modifying the library's own classes at runtime, which is hard to trace and breaks on upgrades).

---

## Cross-reference: luzkan ↔ refactoring.guru

### Naming differences

| luzkan                 | refactoring.guru       |
| ---------------------- | ---------------------- |
| Duplicated Code        | Duplicate Code         |
| Lazy Element           | Lazy Class             |
| Fate over Action       | Data Class             |
| Insider Trading        | Inappropriate Intimacy |
| Conditional Complexity | Switch Statements      |
| "What" Comment         | Comments               |
| Data Clump             | Data Clumps            |
| Message Chain          | Message Chains         |

### Placement differences

luzkan's Data Dealers category has no analog in refactoring.guru, so two smells land in different categories across sources:

| Smell         | luzkan       | refactoring.guru |
| ------------- | ------------ | ---------------- |
| Message Chain | Data Dealers | Couplers         |
| Middle Man    | Data Dealers | Couplers         |

### Smells only in luzkan

Clever Code, Complicated Boolean Expression, Complicated Regex Expression, Obscured Intent, Status Variable, Fallacious Comment, Fallacious Method Name, Boolean Blindness, Inconsistent Names, Magic Number, Uncommunicative Name, Afraid To Fail, Binary Operator in Name, Indecent Exposure, Type Embedded in Name, Combinatorial Explosion, Null Check, Oddball Solution, Required Setup or Teardown Code, Vertical Separation, Callback Hell, Dubious Abstraction, Flag Argument, Special Case, Base Class depends on Subclass, Inappropriate Static, Imperative Loops, Mutable Data, Side Effects, Global Data, Hidden Dependencies, Tramp Data.

---

## Refactoring techniques — definition table

Every technique named in a smell's **Refactoring** line. Definitions are intentionally terse; see [refactoring.guru/refactoring/techniques](https://refactoring.guru/refactoring/techniques) for walkthroughs.

### Extract

| Technique          | What it does                                                                 |
| ------------------ | ---------------------------------------------------------------------------- |
| Extract Method     | Pull a block of code into a new named method; replace the block with a call. |
| Extract Function   | Same as Extract Method, in non-OO contexts.                                  |
| Extract Class      | Move cohesive fields and behavior out into a new class.                      |
| Extract Subclass   | Move features used only by some instances into a new subclass.               |
| Extract Superclass | Lift shared members of two classes into a common parent.                     |
| Extract Interface  | Lift the method signatures clients depend on into a named interface.         |
| Extract Variable   | Name a sub-expression with a local; alias for Introduce Explaining Variable. |
| Extract Module     | Split a module along cohesive lines into smaller modules.                    |

### Move & rename

| Technique                       | What it does                                                     |
| ------------------------------- | ---------------------------------------------------------------- |
| Move Method                     | Relocate a method to the class that uses it most.                |
| Move Field                      | Relocate a field to the class it really belongs to.              |
| Move Declaration Near First Use | Place a variable's declaration next to where it first gets used. |
| Rename Method / Variable        | Change the name to reflect the actual behavior or meaning.       |
| Pull Up (Method / Field)        | Move a member duplicated in subclasses up into the parent.       |
| Push Down (Method / Field)      | Move a member used by only one subclass down from the parent.    |

### Replace

| Technique                                | What it does                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| Replace Conditional with Polymorphism    | Turn a type-code switch into methods dispatched across subclasses.        |
| Replace Type Code with Subclasses        | Replace an enum-ish field with a subclass per value.                      |
| Replace Type Code with State / Strategy  | Replace the type code with a State or Strategy object field.              |
| Replace Data Value with Object           | Upgrade a primitive into a class with behavior and invariants.            |
| Replace Inheritance with Delegation      | Subclass becomes a field holder; forwards to the former parent.           |
| Replace Temp with Query                  | Replace a local variable's expression with a small method callers invoke. |
| Replace Parameter with Method Call       | Caller stops passing something the callee can compute itself.             |
| Replace Control Flag with Break / Return | Delete the `done = true` flag; exit the loop with `break` / early return. |

### Introduce

| Technique                     | What it does                                                              |
| ----------------------------- | ------------------------------------------------------------------------- |
| Introduce Parameter Object    | Group a recurring parameter cluster into a named object.                  |
| Introduce Null Object         | Provide a no-op implementation so callers don't need null checks.         |
| Introduce Explaining Variable | Name a sub-expression with a descriptive local.                           |
| Introduce Foreign Method      | Add a free function that operates on a third-party type you can't modify. |
| Introduce Local Extension     | Wrap or subclass a third-party type to add the methods you need.          |

### Simplify

| Technique               | What it does                                                              |
| ----------------------- | ------------------------------------------------------------------------- |
| Decompose Conditional   | Extract predicate, then-branch, and else-branch into separate methods.    |
| Consolidate Conditional | Merge branches that share a body behind a single predicate.               |
| Collapse Hierarchy      | Merge a subclass and parent when one adds nothing.                        |
| Inline Class            | Absorb a class's members into its caller; delete the class.               |
| Inline Method           | Replace calls to a trivial method with its body; delete the method.       |
| Inline Variable         | Replace uses of a trivial temp with its expression.                       |
| Hide Delegate           | Callers talk to the server class; it forwards to the delegate internally. |
| Hide Method             | Narrow method visibility so it's no longer part of the public API.        |
| Remove Middle Man       | Callers talk to the delegate directly when the wrapper only forwards.     |
| Remove Setting Method   | Delete a setter so the field becomes write-once at construction.          |
| Encapsulate Field       | Make a field private; route reads/writes through accessors.               |
| Encapsulate Variable    | Route access to a module-level variable through functions.                |

### Other

| Technique                    | What it does                                                               |
| ---------------------------- | -------------------------------------------------------------------------- |
| Preserve Whole Object        | Pass the owning object instead of several of its fields.                   |
| Form Template Method         | Lift a shared algorithm skeleton into a parent; let subclasses vary steps. |
| Separate Query from Modifier | Split a method that both returns data and changes state into two methods.  |
| Parameterize Method          | Merge near-identical methods into one with a parameter for what varies.    |
