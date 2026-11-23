# Tool conventions

The rules every tool in this package follows, so tools read alike across
domains and harnesses. Each rule carries the reason it was chosen; a change
to a rule changes this file first, with its reason.

## Names

- **Tool IDs are `<prefix>_<domain>_<verb>`**: `<prefix>_note_read` and
  `<prefix>_note_create` for a `note` domain. The prefix is `toolPrefix` in
  `src/project.ts`; it keeps a name unambiguous where a harness lists every
  tool in one namespace. When the domain has a well-known command line,
  follow its word order, so a name maps to a command anyone can look up.
- **The same ID in every entry point.** Permission rules and skills are
  written once, and an ID is a public interface: renaming one is a breaking
  change.
- **Verbs are plain**: `create`, `edit`, `delete`, `add`, `remove`, and these
  with a fixed meaning:

  | Verb      | Means                                                        |
  | --------- | ------------------------------------------------------------ |
  | `read`    | the one read tool of a domain (below)                        |
  | `resolve` | find which object a call means                               |
  | `ensure`  | create when missing, reuse when present; never a second copy |

- **One read tool per domain, one write tool per operation.**
  `<prefix>_<domain>_read` takes a `method` argument (`view`, `list`, …). A
  model picks tools worse as their number grows, and reads share one set of
  annotations, so folding them loses nothing. Writes stay apart because a
  merged write tool would carry its strictest class: creating something would
  ask like overwriting it.
- **Names stay within 40 characters**, so a client prefix such as
  `mcp__<server>__` still fits a 64-character limit. `defineTool` enforces
  the shape and the length; `src/tools.test.ts` enforces the prefix.

## Arguments

- **snake_case**, for arguments and for the keys of a result alike: one style
  for everything a model reads.
- **Lists change through flat arguments**: `add_tags`, `remove_tags`. Shallow
  schemas are read reliably by every model the harnesses run. An argument that
  replaces a whole list, where one is needed, is named for the list (`tags`)
  and its description says it replaces.
- **Unknown arguments are refused.** Every entry point validates the
  arguments as strict, so a misspelt one fails as `invalid_argument` instead
  of being ignored.
- **The tools' own install directory is never the working tree.** A harness
  may start a tool inside the directory the package is installed in.
  `ToolContext.ownDir` names it; a tool that reads the working tree refuses
  to treat that directory as the caller's, saying so.
- **The MCP server takes the call's directory from the client.** It uses a
  directory sent with the call (Codex), else the client's first usable root,
  else the process's working directory; never inside the install directory.
  This keeps a server started in its install directory out of the working tree.

## Results

- **A tool returns its data as a plain object**, with no `ok` envelope. Each
  entry point renders it: the MCP server as `structuredContent` with the
  tool's `outputSchema` plus the same JSON as text, a native plugin as a JSON
  string.
- **A failure throws.** Every harness then sees a failed call (`isError` over
  MCP) rather than a success that carries an error.
- **One exception: what a call created is never lost.** Once a tool has
  created something, a later step of the same call that fails does not throw.
  The result names what was created and lists the failed steps under
  `errors`, keyed by step (`StepErrors`).
- **Text a tool reads is returned as it is.** Content from files or services
  is data, never instructions; every read tool's description and the skills
  say so. Nothing is wrapped or rewritten.

## Errors

A thrown error carries a `code` a caller can branch on, and a message that
says what to do next.

| Code               | When                                                                       |
| ------------------ | -------------------------------------------------------------------------- |
| `not_found`        | the object does not exist, or the caller cannot see it                     |
| `forbidden`        | the caller lacks the permission the call needs                             |
| `invalid_argument` | the arguments cannot describe a valid call                                 |
| `stale`            | what the call relied on changed before it could finish                     |
| `unauthenticated`  | the service or program the tool calls is not logged in                     |
| `rate_limited`     | the service refused the call for its rate limit                            |
| `declined`         | the person declined a confirmation the tool asked for                      |
| `upstream_error`   | the service or program the tool calls failed; the message carries its text |
| `internal_error`   | a bug in a tool or an entry point, such as a result off its schema         |

A project adds a code to `src/core/errors.ts` and to this table together.

- **Structure the caller needs goes in `details`, not in the message.** When
  fixing the cause takes more than a sentence (the lint violations, the
  findings, the output of a hook), the error carries it as `details`: a JSON
  object with snake_case keys, like a result. A model then reads the fields
  instead of parsing them back out of prose; the message still says what to
  do next on its own.
- **`details` is fixed when the error is made.** `ToolError` keeps a frozen
  JSON copy, so every entry point renders the same value. The copy is what
  JSON makes of it (`undefined` is dropped, `NaN` becomes `null`), and a value
  JSON cannot write at all, such as a cycle or a `BigInt`, fails where it was
  thrown, as a bug, not where it is rendered.
- **Each entry point passes `details` on only when it is set**, so an error
  without it reads as it always did. The MCP server and the command line put
  it beside the code and the message, as `error.details`. The OpenCode and
  Hermes plugins, whose errors are text, append it to `<code>: <message>` as
  JSON on a line of its own.
- The `errors` of a partial result (`StepErrors`) stay `<code>: <message>`
  strings.

## Write classes

Every tool belongs to one class, and the class sets its MCP annotations.
`openWorldHint` is `true` for every tool.

| Class             | Examples                              | `readOnlyHint` | `destructiveHint` | `idempotentHint` |
| ----------------- | ------------------------------------- | -------------- | ----------------- | ---------------- |
| read              | view, list, resolve                   | `true`         | —                 | `true`           |
| add               | create, add                           | `false`        | `false`           | `false`          |
| idempotent change | ensure, adding a tag                  | `false`        | `false`           | `true`           |
| overwrite         | editing a body or title, removing one | `false`        | `true`            | `true`           |
| administrative    | delete, visibility, publishing        | `false`        | `true`            | `false`          |

- **Overwriting counts as destructive**: it loses what was there, and
  harnesses that confirm only destructive tools should still ask before it.
- **A tool takes the strictest class its arguments can reach.**
- **The harness confirms writes.** Every MCP client asks before it runs a
  write tool, so the tool does not ask again by default. Administrative tools
  also carry `_meta["anthropic/requiresUserInteraction"]: true`, which makes
  Claude Code ask even under an allow rule.
- **A native plugin asks the harness's own permission before every non-read
  call**, since the tools a native plugin adds pass through no harness
  approval of their own.
- **It asks for everything the call writes to.** A write tool's `targets`
  resolver names what the call writes to, as the permission rules name it
  (a path, an account, a record). Anything it cannot tell, every tool
  without a resolver, and a target holding `*` or `?` (which a harness would
  store as a pattern) is `*`, and `*` is never stored. An "always" answer then
  covers only what it named, never a write somewhere else.
- **It shows what the call carries, where the tool can say.** Targets are
  ids, so they cannot tell one kind of target from another, and the person
  decides on the text, the file or the kind of target as much as on where it
  goes. A write tool's `describe` says it. An MCP client draws the call's
  arguments in its own prompt, so the MCP server adds nothing.
- **Every native plugin's prompt has one shape**, so a person reads every
  tool's prompt the same way:

  ```text
  About to create "todo.md"

  --- Details ---

  Target: /work/tree/notes/todo.md
  Size: 42 bytes

  --- Note text ---

  # Todo
  ```

  The headline says what the agent is about to do, as its next step; the
  Details name each target on a `Target` line, then the tool's facts; the
  last section is the text the call carries, under the tool's own label. A
  section with nothing to show is left out, so a tool without `describe`
  shows its intent and its targets, and one whose targets cannot be told
  shows its intent alone. The harness names the tool beside the prompt, so
  the prompt does not repeat its id.

- **A write tool states its intent.** Besides its title, which names the
  tool wherever tools are listed, a write tool gives an `intent`: a fixed
  phrase in the headline's tone that carries no value (`About to create a
note`). The prompt shows it wherever no headline can stand: a tool without
  `describe`, a headline that is dropped, and one that gives way to keep the
  targets within the budget. A tool without an intent shows its title there.

- **The tool's words are fixed; what the call carries is data.** A model
  chooses the arguments and nothing else, and a prompt is only as good as the
  person's trust in its lines. The headline is the tool's intent, or a
  template the tool picks (`About to create {file}`) whose values the entry
  point quotes, so where the tool's words end and the call's data begins is
  always visible. A value comes from what the tool resolved, never from a
  model's account of it (the record's real name, not the name the model
  gave). The text section holds what the call writes, as it is, never a
  summary of it; a summary the tool can compute is a fact (`Size`, `Lines`).
- **Facts are short and ordered by what they decide.** A label is a noun of
  one or two words, in English like the tool's title, and a value carries
  its unit (`42 bytes`). A value with a unit or other words of the tool's is
  a template the tool picks with the values it holds (`{bytes} bytes` with
  `bytes: 42`), so the unit is the tool's word and the number the call's
  data; the tool picks the English form for the count (`{bytes} byte` for
  one), and numbers are shown as written, without digit grouping. A plain
  string value has no words of the tool's. The fact that changes the person's answer comes
  first (the kind of target, whether it overwrites); amounts come last. A
  fact never repeats the headline or a target. `src/core/facts.ts` holds the
  facts every package can use (`sizeFact`); a package adds its own beside its
  tools in the same form and lists them in its section below.
- **The head of the prompt comes first and fits; the text comes last.** Some
  harnesses cut a prompt from its end at a few hundred characters, so the
  headline, the targets and the facts are kept within the budget of where the
  prompt is shown, and the text is what is cut. A headline that would push a
  target past the cut gives way to the intent, since the targets are what an
  "always" answer stores. Facts that do not fit are counted on a notice
  line, which stays even when the head alone fills the budget: a person
  must know that something was left out. The facts a description drops past
  its eighth are counted on the same line, `(+N more)` after the facts, in
  every prompt, budget or none. A description keeps a
  headline template of 120 characters with values of 80, its first eight
  facts with labels of 40 characters and values of 200 (a value template of
  200 with at most eight values, the filled value cut to 200), and a text label of
  40 with a text of 2000; anything longer is cut with `…`. Nothing in the text
  can come before the facts, since the text is the last section.
- **A cut text says how much it leaves out.** A `…` also ends many ordinary
  messages, so it alone cannot tell a person that the text goes on, or how
  far. A text cut at its 2000 characters is followed by a notice line,
  `(+N more characters)`, and a fact's value cut at its 200 by the same
  notice after it on its line, where the line still fits the budget; a value
  the budget cuts further ends in `…` alone, since what it drops is no longer
  counted in the tool's characters. N counts the code points left out of what
  the tool gave, the unit the cut counts (`(+1 more character)` for one), and
  the notice is the plugin's own words, translated like the facts' notice.
  Only the head counts towards the budget, so the text's notice is lost
  wherever the harness cuts the text, which then shows its own end mark.
- **Characters other people wrote are shown, never obeyed.** A target's name
  or a file's name can hold control, bidi and invisible characters that
  forge a line of the prompt or hide part of a value; each is shown as
  `<U+XXXX>`, and a quote inside a headline value as `\"`. Where the prompt
  renders markup, everything but the plugin's own section lines is escaped,
  so a name cannot draw a link or a mention. The budget and the escaping are
  those of the surface the harness names. A surface the harness shows as
  written, such as its own clients, gets neither. A surface it names that the
  plugin does not know is one the harness does not cut, so it gets no budget,
  but it may render markup the plugin cannot tell, so it gets the strictest
  escaping of all: an escape shown as written reads as a stray backslash,
  while a name left unescaped can draw a link or a mention. A prompt whose
  surface cannot be told gets the strictest budget and escaping of all.
- **A description never stands between a call and its approval.** A tool
  without `describe`, a `describe` that fails, returns another shape or takes
  longer than 10 s gives the prompt it would have given without one. The
  approval is asked either way, and the targets are never lost with the
  description.
- **A call no answer may let run is refused before anyone is asked.** Some
  calls are out of reach whatever the person would say, such as one naming
  an object the settings keep away from the agent; a prompt for it would
  show what it names and invite an "allow" that cannot be honored. A tool
  that can tell such a call from its arguments and settings gives a `gate`
  (see "The core contract"). Every entry point runs it before the approval
  and again before `execute`, so a refusal is the call's result, as an
  error, and no prompt is drawn: a native plugin asks nothing, and the
  Hermes plugin blocks the call. Unlike `targets` and `describe`, a gate
  fails closed: one that cannot tell fails the call with `internal_error`.
  Where the question itself cannot be resolved (the Hermes plugin's `target`
  fails or times out), the person is asked as before, and the run refuses
  the call after the answer. An MCP client draws its own prompt before the server sees the call, so
  there the refusal comes after the client's question, never after the run.
- **A call runs on what its prompt showed.** What a person approves is what
  was true when the prompt was drawn; between the answer and the run, a file
  the call reads can be rewritten or a target can change kind. So a native
  plugin pins the prompt of every call whose tool has `describe`: the
  targets and the description, before translation, as one hash. The hash
  takes the description whole, before the budgets above cut it: a text past
  its 2000 characters, a value past its cut and the facts past the eighth
  are what the call carries too, so a change there is a change of the call
  even where the prompt could not show it. Right
  before the call runs, the entry point resolves both again, and a call
  whose hash differs, or whose description can no longer be told, fails with
  `stale` without running; the person is asked again on the next call. A
  call whose prompt showed no description pins nothing and runs as before,
  and so does every call of a tool without `describe`. A `describe` may also
  give `pins`, values the prompt does not show that the call must still find
  unchanged (a file's hash, beside a size that can stay the same); they go
  into the hash and nowhere else. A `describe` therefore gives the same
  answer for the same state: a value that changes on every call, such as the
  time, makes every call `stale`. The check narrows the gap between the
  answer and the run to the moment before `execute`; a tool that must close
  it entirely still checks inside `execute`. An MCP client draws the call's
  arguments, not a description, so the MCP server pins nothing.
- **The prompt speaks the language set for the harness.** A native plugin
  draws its prompt in the language of the `language` setting, else in the
  harness's own display language where it has one (Hermes's
  `display.language`), else in English. No harness tells a plugin who
  approves a call, so this is the language set where the plugin runs, not
  each person's. The server's locale (`LANG`) is never read: it is the
  machine's, and a person reading English on a machine set to another
  language would see the prompt change. A tag matches its own table, else
  the one of its first subtag (`ja-JP` and `ja_JP` are `ja`; `zh-Hant` can
  have its own), and a language the package has no words for falls back to
  English without a word. An MCP client draws its own prompt,
  so the MCP server takes no `language`.
- **Translations are tables keyed by the English words.** The plugin's own
  words (`Details`, `Target`, `(+N more)`) and a tool's (its title, its
  intent, its headline templates, its fact labels, its value templates and its text
  label) are written in
  English in the code. Per language, a package gives one table from those
  English words to their translation (`src/words.ts`), and the entry point
  looks each word up as it draws the prompt, so a tool's code does not change.
  A translated template must hold the same placeholders as the English one
  and keep within its limits, or the English one is used, so a translation
  cannot move the line between the tool's words and the call's data. Values
  are the call's data and are never translated: a value template is looked
  up and its values filled in after (`{bytes} バイト`), and a plain string
  value stays as the tool wrote it. A translation is marked like every other
  piece of the prompt.
- **`confirm: "elicitation"` adds the tool's own form** for administrative
  tools, where the client offers form-mode elicitation. It is for people who
  switch the client's approvals off: the tool states what will happen in plain
  words and stops on anything but an accept. Where the client does not offer
  elicitation the setting adds nothing, and the harness's approval is then the
  only confirmation.
- **Annotations are hints, not a boundary.** The `read_only` setting
  (below) is what keeps writes out.

## Toolsets and settings

Every entry point takes the same settings:

- **Toolsets**: one per domain, listed in `src/project.ts` with the ones on by
  default. A small default keeps the model's choice sharp.
- **`read_only`** registers no write tool, and wins over every other setting.
- **`tools` / `exclude_tools`** add or remove single tools; an exclusion wins
  over an inclusion.
- **`confirm`** is `harness` (the default) or `elicitation`; it says who asks
  before an administrative tool acts (see "Write classes"). The default leaves
  the question to the harness, whose approval every user already knows.
- **`language`** is the language of a native plugin's approval prompt (see
  "Write classes"); unset, the prompt follows the harness's display language
  or stays in English.
- **`emoji`** maps a toolset name to the emoji the Hermes plugin shows beside
  it, merged over the package's `TOOLSET_EMOJI`; `""` shows no emoji for that
  toolset, and no other entry point shows an emoji. A value that is not a
  mapping, an entry whose value is not a string, and a name that is no toolset
  are ignored rather than refused: the setting only changes what is shown, so a
  typo must not take every tool away.
- **`require_plugins`** names the Hermes plugins the Hermes plugin's writes
  depend on, such as a guard whose `pre_tool_call` block keeps writes from
  running unattended. Hermes drops a plugin that fails to import or register
  and loads the rest, and treats a manifest's `requires_plugins` as advisory,
  so a guard can vanish with nothing to say so. While any named plugin is not
  loaded (`ctx.has_plugin` says no, or cannot be asked), every call of a tool
  that is not a read is refused before its approval is asked, so neither YOLO,
  an approvals mode of `off` nor a remembered answer lets it run, and again
  before it runs. The refusal is `forbidden` with `details.reason`
  `missing_plugin` and `details.plugins` the names missing. Reads run as
  before. The check runs on every call, not at registration, since the order
  in which Hermes loads two plugins is not the plugins' to fix. Unset or
  empty, nothing is checked. A value that is not a list of names is refused,
  like a wrong `read_only`, and the plugin then registers nothing: ignoring it
  would loosen what the person asked for. No other entry point has it.
- **Options** are the package's own settings, the ones the tools themselves
  read, listed in `options` in `src/project.ts` (and `OPTIONS` in the Hermes
  plugin's `project.py`), each mapping a snake_case name to its type (`text`,
  `boolean`, `number`, `list`, `path` or `paths`) or a declaration with
  `{ type, integer, min, max }`. `integer: true` requires a whole `number`;
  `min` and `max` bound a `number` or count the items of a `list` or `paths`.
  Only `type` is required. Its flag is the name with `_` as `-` (a
  `boolean` flag takes no value), its variable is `<envPrefix>_<NAME>`
  uppercased, and its plugin option or setting is the name itself. A flag wins
  over its variable, an option over its variable, and a blank text or path or
  empty list counts as unset. A `path` is trimmed; `~` alone or followed by
  `/` (or the platform separator) stands for the home directory: `HOME` when
  it is absolute, else the account's.
  The expanded path must be absolute and reaches the tool normalized, without
  a filesystem check. A `paths` value is a list of such paths, comma-separated
  in a flag or variable and an array of strings in a plugin option; items are
  trimmed and blank items dropped, and none left counts as unset. Bounds
  check only a value that is given, after blanks are dropped; unset stays
  unset. Refused values are `invalid_argument`, naming the flag, variable or
  option and what it must be. A package should not have to check a directory
  or a limit again inside its tool. They reach a tool as `context.options`,
  keyed by name, and one that is not given is absent: a neutral default means
  unset, and the tool then does nothing extra. A tool reads an option when it
  runs, so a change applies on the next call.
- **`unattended`** says that no person can answer a question, as in a
  scheduled job, CI or a headless run; **`grants_dir`** is the `path` where
  grants and their use are kept. See "Writes no one is there to approve".

## Writes no one is there to approve

When no person can answer, a harness either refuses a write or, with its
approvals skipped, runs it with no limit at all; a host's allow rule names a
tool and at most its targets, with no expiry, no count and nothing about what
the call carries. So a person delegates, in advance, a bounded set of writes,
and every entry point checks them the same way.

- **The person decides what to delegate; the package keeps only its
  guarantees.** A person who cannot delegate a write still runs it
  unattended through the host, with no bound and no record, so a rule that
  narrows what can be delegated protects nothing and only pushes the person
  there. The package limits a grant only where the mechanism needs it: the
  expiry ceiling, that only a person's answer creates a grant, and the
  signatures, the log and the lock. Everything else (which tool, which
  targets, which bounds, how many calls) is the person's choice, shown whole
  on the consent screen.

- **A setting says that no one can be asked.** No harness tells a plugin or
  an MCP server that its questions will go unanswered, and the modes that
  skip approvals are the ones with no person in the loop, so nothing is
  inferred from them. `unattended` says it. Off, the default, nothing changes
  and grants are not read. On, a read runs as before and a write runs only
  under a live grant that covers it.
- **Every write tool can be granted; a tool may add what a grant can
  bound.** A grant over any write tool limits its targets, its rate and its
  expiry. `bounds` adds more, naming each bound with its kind: `max` (a whole
  number the call must stay at or under, such as a text's length in
  characters), `allow` (whether the call may do one thing, such as attach a
  file), `oneOf` (the values the call may use, such as DNS record types) or
  `prefix` (the paths the call's values must sit under, such as the folders
  a file may be written to, for a set of values no tool could list ahead; the
  tool declares the one character its paths split at, such as `/`).
  `measure(args, context)` gives the call's value for each: a number, a
  boolean, or one or more of the declared values or paths. A path is matched
  as the string `measure` gives, so the tool gives it in the one form its
  target reads (relative parts resolved, case and suffixes settled); the
  package reads nothing into it. A tool declares at most six bounds and a
  grant's values must fit a fact (200 characters), so the consent screen
  shows every one. A bound is a fact about the call, computed the same way
  every time, never the model's account of it, and it is checked whole, never
  cut to a budget as a prompt's facts are.
- **A grant** names one tool, its targets, a value for the bounds the person
  limits, a rate in calls per hour or none, and an expiry of at most 90 days.
  Its targets are names, or `*` alone for any target, the call's included when
  it cannot be told; a pattern beside or inside a name is refused. Its paths
  for a `prefix` are compared as given: one that is blank, holds `*` or `?`
  or ends in the separator is refused, since a pattern grants more than it
  names and a trailing separator covers nothing the person was shown (so the
  separator alone cannot be granted). A call is covered when its
  tool matches, every target it resolves is among the grant's (or the
  grant's is `*`), every bound the grant sets is met by the measured value
  (at or under a `max`, `false` or allowed for an `allow`, every value among
  a `oneOf`'s, every value one of a `prefix`'s paths or under one, the
  separator right after it, so `a/b` covers `a/b/c` but never `a/bc`, which
  only shares its characters), the grant has not expired, and, when it sets
  a rate, fewer calls than the rate ran under it in the last 60 minutes. A
  bound the grant leaves out is no limit, and the consent screen says so; a
  measure that fails or returns another shape covers nothing under a grant
  that sets a bound. Where several grants cover a call, one that names its
  targets is used before a `*` one, then the one with the fewest targets,
  then the one that sets the most bounds, then the one that expires first.
  A call counts against its grant's rate whether it succeeds or fails, and
  every call is logged whether the grant sets a rate or not.
- **Grants restrict; the host still allows.** `invoke` checks the grant
  after the gate and before `execute`, so the MCP server and the command
  line's `run` enforce it too, and the native plugins and the Hermes
  plugin's `target` check it before they ask, refusing without a question.
  The harness's own permission still decides whether the call reaches the
  package at all (an allow rule, an allowed-tools list, an approve mode), so
  a grant means the same in every harness and never lets a call through
  that the host would stop.
- **A refusal says why.** It is `forbidden`, with `details.reason`.
  `person_only` (a tool only a person's own answer may run), `no_key` and
  `tampered` (a grant or the log fails its MAC) refuse every call. Otherwise
  each grant that names the tool is checked in order, `expired`, `target` (a
  target outside the grant, or one that cannot be told, under a grant that
  names its targets), `bound` (named in
  `details.bound`) and `rate`, and the reason is the one of the grant that
  passed the most checks; `no_grant` when none names the tool. The message
  says what a person would change: a new grant, or waiting for the rate.
- **A person delegates; the agent only asks.** `<prefix>_grant_create`
  takes the tool, the targets, the bounds, the rate, the days it lasts and a
  reason. It is administrative, and its prompt is the consent screen: the
  headline names the tool (and says it may write anywhere under `*`), the
  facts the rate (or no limit), the expiry and every bound the tool declares
  (`no limit` for one left out), named targets stand as targets (a prompt
  shows no target line for `*`, so the headline carries it) and the reason
  as text, and the pin makes the
  grant exactly what the prompt showed. Widening or extending one is a new
  grant. `<prefix>_grant_read` lists the grants and their use, and
  `<prefix>_grant_revoke` removes one. They form the `grants` toolset, off by
  default.
- **Only a person's answer creates a grant.** A grant that the agent could
  give itself would bound nothing. `grant_create` is marked person-only: it is
  refused while `unattended` is on, no grant ever covers a person-only tool
  nor can one be created for it, and every
  entry point keeps a standing answer from covering it: the OpenCode plugin
  makes its permission `ask` with nothing to save, the MCP server marks it
  `requiresUserInteraction` and asks through form elicitation where the
  client offers it, whatever `confirm` says, and the Hermes plugin gives each
  call a rule key of its own. A harness run with every approval skipped asks
  about nothing, and no package can tell; the README says so for each
  harness. Revoking only narrows, so `grant_revoke` runs while `unattended`
  is on without a grant.
- **Grants and their use are signed with a key the host supplies.** The
  variable `<envPrefix>_GRANT_KEY` (at least 32 characters; a variable only,
  never a flag or a plugin option, so it stays out of configuration files)
  keys an HMAC-SHA256 over each grant and over a chained log of every call
  made under one: the grant, the tool, the targets, the measured values, a
  digest of the arguments, when it started and how it ended. A grant or a
  log edited outside the package fails its MAC, and nothing runs under any
  grant until a person revokes the grant that fails (`grant_read` marks it)
  or, for the log, clears the directory. Without the
  key, while `unattended` is on, no write runs and no grant can be created.
  The files are written under a lock and replaced whole, since several
  processes may run calls at once. An earlier copy put back whole, MACs
  included, is not detected; the expiry bounds what it can bring back.

## Skills

- **A skill names the toolset it documents**, under `metadata` in its
  frontmatter:

  ```yaml
  metadata:
    toolset: notes
  ```

  The Agent Skills format allows no other top-level key, and its validators
  refuse one. The value is a plain or quoted one-line scalar; any other form
  reads as no link. A folder's name never links a skill, so every entry point
  reads the link the same way without knowing the package's toolsets.

- **A native plugin registers a linked skill only when its toolset is on**:
  when the settings register at least one tool of that toolset, from the same
  selection the tools come from. A skill that describes tools the model does
  not have invites calls that fail. So `read_only`, `tools` and
  `exclude_tools` count too: a toolset whose every tool is left out takes its
  skill with it. A skill with no link is always registered.
- **Plugins that install the skill folder whole cannot follow the settings**:
  Claude Code, Codex, Grok Build and Antigravity load every skill, since the
  settings reach only the MCP server.
- **Every linked skill names one of the package's toolsets**; a test checks
  it, since a misspelt link would hide the skill wherever it is filtered.
- **A skill that works across toolsets names the one it cannot work without.**
  The link holds one toolset, and a skill linked to none would be registered
  with every tool it describes turned off. Its body says which steps to skip
  when another toolset's tools are missing, and it leans only on toolsets that
  are on by default, since the plugins that install the skill folder whole
  list it whatever the settings select.

## The core contract

- A tool spec declares its ID, description, argument schema, output schema,
  toolset and write class; every entry point derives the same metadata from
  it. A write tool also declares `targets(args, context)`, which names what
  the call writes to.
- Any tool, read or write, may declare `gate(args, context)`, which throws a
  `ToolError` (usually `not_found`, worded as for an object that does not
  exist) for a call no approval may let run, and returns otherwise. `invoke`
  runs it after the arguments are checked and before `execute`; the entry
  points also run it before they ask (see "Write classes"). It is cheap, it
  reads only what it needs to decide, and its message says no more about
  the target than the arguments already do.
- A write tool may declare `bounds` and `measure(args, context)`, which say
  what a grant over it can limit beyond its targets, rate and expiry, and
  what this call's values are (see "Writes
  no one is there to approve"). `defineTool` refuses a `measure` without
  `bounds`, a bound of an unknown kind, a `oneOf` with no values, a `prefix`
  whose separator is not one character (or is blank, `*` or `?`) and more
  than six bounds.
- `execute(args, context)` gets the working directory, an abort signal, an
  optional `ownDir` (the directory the tools are installed in, never the
  working tree), the values of the package's own settings as `options` (see
  "Toolsets and settings"; `gate`, `describe` and `targets` get them too),
  the state directory as `stateDir`, a `runtime` (the variable prefix, the
  command line a recovery command names, the environment, the clock and the
  `fetch` the Google client calls through, which tests replace) and an
  optional `confirm(request) => Promise<boolean>` hook.
  Nothing in it names a harness. An entry point supplies `confirm` when the
  `elicitation` setting is on; without it the harness's approval stands, and a
  tool that needs a confirmation treats a missing hook as the harness having
  approved the call.
- `src/core/` uses only the `node:*` modules and plain dependencies, never a
  runtime's own globals (`Bun.spawn`, `Bun.file`, …), so the same code runs on
  Node and on Bun. It knows no project either: names, prefixes and toolsets
  come from `src/project.ts` through the entry points.

## Programs a tool runs

- **Every program a tool runs goes through one runner** built on `exec`, with
  an explicit environment: what the program needs to find itself and
  authenticate is passed through, and nothing else, so a stray variable
  cannot redirect a call. Prompts and colors are switched off, so nothing
  waits on a person and output parses the same everywhere. A program's
  standard input is text or a stream the runner pulls from as the program takes
  it in, so a large file is never held whole; a program that exits without
  reading it all is that program's failure, never a crash of the process.
- **Every variable the tools read besides the settings is named in
  `toolVariables` in `src/project.ts`**, whether a tool reads it itself or
  passes it through to a program. Codex gives a plugin's server only a few
  basic variables (`PATH`, `HOME` and the like) and those its manifest names,
  and `pnpm run manifests` writes that list from the settings and
  `toolVariables`: a variable left out is set everywhere but in Codex.
- **Every call has a time limit**, and a call that is stopped, by that limit
  or by cancellation, has its child process killed: `SIGTERM`, then `SIGKILL`
  after two seconds. A hung program neither holds a harness forever nor
  outlives its call.
- **The runner maps the program's failures to the error codes above.**

## Tests

- Tests sit beside the code they test (`*.test.ts`) and run on `bun test`;
  CI also starts the built MCP server, plugin and command line under Node and
  lists their tools, so a runtime-only API cannot slip in unnoticed.
- No test reaches a real service. A tool that runs a program is tested
  against a fake of that program on `PATH`.
- A test file stays within about 300 lines, split by topic
  (`<name>.<topic>.test.ts`), so one commit can carry a change and its test.

## The OAuth client

- **The user brings the OAuth client; the package ships none.** It is a
  Desktop app client of a Google Cloud project of the user's own, given to
  `login` as the JSON file the console downloads. A client shipped in a
  package would be shared by every user, its quota and its consent screen
  with them, and its secret would be public.
- **Its publishing status is In production.** A client left in Testing gets
  refresh tokens that end 7 days after consent; In production they do not,
  verified or not. Personal use (the user, or fewer than 100 people they
  know) needs no verification, restricted scopes such as `gmail.readonly` and
  `drive.readonly` included; the person clicks through Google's
  unverified-app screen once per login
  ([expiration](https://developers.google.com/identity/protocols/oauth2#expiration),
  [personal use](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification#personal-use)).
  The README says how to set it.
- **Consent runs only in `login`, a command a person runs.** It opens the
  browser on the loopback redirect (`http://127.0.0.1:<port>`) with PKCE
  (`S256`), the flow Google keeps for Desktop clients now that the
  out-of-band one is gone
  ([desktop apps](https://developers.google.com/identity/protocols/oauth2/native-app)).
  No tool starts a consent: a tool can run where nobody can answer, and a
  consent started by a model is one a person may accept without reading.
- **`remove` revokes the label's token at Google** and deletes the label's
  state, after the label is typed back unless `--yes` is given. Deleting the
  file alone would leave the token valid wherever it was copied.

## Accounts and scopes

- **One label is one Google account.** A label is 1 to 24 lowercase letters,
  digits and `_`, starting and ending with a letter or a digit; `login` names
  it `default` when no label is given. A label is also a directory name and
  part of a variable's name, so the set is kept to what both take as it is.
- **`account` picks the label.** Left out, it picks the only label; with
  several, the call fails as `invalid_argument` and lists them. One account
  is the common case and needs no argument, while several never depend on
  which one a tool guesses.
- **A label holds only the scopes of the toolsets it was logged in for.**
  `login --toolsets <list>` asks for the scopes those toolsets' tools need and
  nothing more, and `login --read-only` only for their read scopes. A label
  for Sheets then holds no mail scope, and a leaked token reaches no further
  than the toolsets it was meant for. One label may hold Workspace and Cloud
  scopes together; the README recommends a label per use.
- **Every login also asks for `openid` and `email`**, which are not
  sensitive, so the label records the address of the account that consented.
  The account read shows it, and a token check notices a login made with
  another account than the label was meant for.
- **Adding a toolset to a label is a new login with the whole list.**
  Desktop clients have no incremental authorization, so every consent grants
  exactly the scopes it asks for, and the new token replaces the old.
- **A tool checks the label's scopes before calling Google.** A tool whose
  scope the label lacks fails as `unauthenticated`, naming the `login`
  command that adds it. The command asks for the calling tool's own toolset
  when that holds a scope the call accepts, else for the narrowest toolsets
  that do; toolsets may share a scope, and a fix should not log a label in
  for a toolset its tools were not called from. Asking Google first would
  spend a call to learn what the label's own record says, and Google's answer
  would not name the fix.
- **Each toolset names its scopes**, read and write apart, with the narrowest
  one each operation accepts; which scope a domain takes is settled with its
  tools.

## Credentials and state

- **Each label keeps all of its state in one directory**,
  `<state root>/accounts/<label>/`, created with mode 700: the credential
  file when there is one and the lock that serializes refreshes.
  The state root is the `state_dir` path option, by default
  `$XDG_STATE_HOME/google-tools` when `XDG_STATE_HOME` is absolute, else
  `~/.local/state/google-tools`. One directory per label means a label is
  moved, backed up or removed as a whole.
- **A label's credential is one JSON object**: the refresh token, the
  client id and secret of the OAuth client that issued it, the scopes granted
  and the account's address. The client is kept with the token, per label,
  since a refresh token can be refreshed only by the client that issued it;
  labels may then use different clients, and replacing one client logs out
  only the labels that use it.
- **It comes from the environment first**: `GOOGLE_TOOLS_CREDENTIALS_<LABEL>`
  (the label in capitals, `GOOGLE_TOOLS_CREDENTIALS_DEFAULT` for `default`),
  holding the same JSON, and the package then stores nothing; otherwise from
  the label's `credentials.json` (mode 600, a regular file and no link),
  which `login` writes. One variable keeps the credential one secret in a
  keychain. How the variable is filled (a keychain, a password manager, a
  service manager's credentials) is the user's choice; the file works where
  nothing injects it, Codex included, which forwards no variable whose name
  depends on a label.
- **A credential that cannot be read is `unauthenticated`, a file anyone
  else can reach is `forbidden`**, and neither message quotes any part of
  it: a JSON parser's message can echo its input.
- **A credential is never an argument, a setting or a tool's input.** A
  harness shows and logs a call's arguments, and settings land in
  configuration files.
- **Access tokens live only in memory** and are refreshed when they expire.
  Refreshes of one label are serialized across processes by a lock in its
  directory, so two harnesses on one machine do not race, and a refresh
  token Google rotates is written back only over the one it replaces, never
  over a newer login.
- **Nothing shaped like a Google credential is ever shown.** Refresh tokens,
  access tokens, client secrets and API keys are masked in every result,
  error message and log, not only the ones in use: an error body can echo
  another one. The account read names where a credential comes from, never
  its value.

## The Google client

- **Every Google call goes through one client**, as every program goes
  through one runner: fixed hosts, a route allowlist per API that each tool's
  calls are checked against, no redirect followed (a redirect would carry the
  token elsewhere), a time limit with cancellation, and Google's failures
  mapped to the error codes. A tool never calls `fetch` itself, and no Google
  command line is run.
- **A route may name one handoff, the only redirect the client follows.**
  Some exports answer every request, whatever the access, with a redirect to
  a signed address on a download host, which serves the file without the
  token. Such a route names the host pattern and path prefix it hands off
  to; the client follows that one redirect only when its address matches
  (`https`, no user info, no fragment), sends nothing but `Accept` to it (no
  token, no cookie), follows no redirect from it, and masks the address in
  every message, since the signature in it is a capability. Any other
  redirect, or one from a route that names no handoff, is `upstream_error`
  and nothing is fetched from it.
- **A route left off the allowlist cannot be reached by any argument.** An
  operation a domain never offers is kept out by the allowlist, not only by
  the tool's schema, so a bug or a crafted id cannot turn a read into it.
- **Google's errors map to the codes above:**

  | Google answers                                                             | Code              |
  | -------------------------------------------------------------------------- | ----------------- |
  | 401, `invalid_grant` on refresh                                            | `unauthenticated` |
  | 403 `PERMISSION_DENIED`, `insufficientPermissions`                         | `forbidden`       |
  | 404 `NOT_FOUND`                                                            | `not_found`       |
  | 412, `FAILED_PRECONDITION` from a changed revision or etag                 | `stale`           |
  | 429, `RESOURCE_EXHAUSTED`, 403 `rateLimitExceeded`/`userRateLimitExceeded` | `rate_limited`    |
  | anything else                                                              | `upstream_error`  |

  The message carries Google's own text, masked, since it often names the
  API to enable or the permission to grant. When Google's message is generic
  and its reply lists field violations (`google.rpc.BadRequest`, such as
  `Unsupported region …`), their descriptions follow it, since they are what
  says which argument was wrong.

- **A value a tool writes to a file, never to a result, is masked for the
  label's own secrets only**, since shape masking would corrupt file content
  such as base64. The tool names those top-level keys of the reply; every
  other value is masked in full.

## What the tools never return

- **Credentials, by any tool.** A token or a secret cannot be taken back once
  it is in a transcript. An operation whose result would have to carry one is
  not offered.
- **The user's content only from the read tools of its domain.** Mail, cell
  values, documents, file contents and comments come from the read tool of
  the domain they belong to; every other read returns names and metadata.
  Unlike a package whose content is a side matter, the Workspace toolsets
  that return it may be on by default: reading that content is what they are
  for.

## Writes

- **A write's arguments are the whole change.** They name what changes by id
  and give the new values; nothing is chosen at run time from the current
  state ("the last row", "every matching message"). The harness shows the
  arguments when it asks, so what it shows is what runs.
- **A write returns what it changed**, before and after where Google gives
  it, so the result can be checked and undone without another read.
- **A write that could land on the wrong place checks first.** Where content
  can shift under a call (rows inserted above, a document edited since it was
  read), the tool takes what it expects there (cells, a revision id, an etag)
  and refuses as `stale` when Google's differs. Which operations do is settled
  per domain.
- **A write that deletes, moves or overwrites content, or changes who can
  reach it, is a tool of its own** with the destructive annotation, never an
  operation of a tool that also does harmless edits: a harness that remembers
  an approval for a tool would otherwise carry it over to the harmful call.
- **What a domain never offers is settled with its tools**, from the risks
  its research names (a mail filter that forwards everything, a permission
  that makes a file public, IAM, a payload that is a secret), and this file
  records each with its reason. Nothing is ruled out before its domain is
  reviewed.
- **There is no preview step and no plan digest.** The harness's approval of
  the arguments, with `targets` naming the account and the object, is the
  confirmation.

## Approval prompts

- **Every write tool states its intent and describes every call it can tell
  before it runs.** Targets name ids, which say where a call writes but not
  what is there: the person needs the spreadsheet's title and the range, the
  mail's recipients and subject, the service and the image.
- **`describe` reads what `execute` reads, with the same code.** The
  description is planned by the function the call runs on, so it cannot
  promise a write the call would not make. Where `execute` would refuse,
  `describe` throws, and the call then fails with its own message.
- **Values are what Google reports**: a file's name, a tab's title, a
  service's current image. An argument stands in only for what does not
  exist yet.
- **Each domain keeps its words, and their translations, in its `words.ts`**;
  `src/words.ts` gathers them, and the facts a domain's prompts show are
  listed here with the domain's tools.

## Files

- **Downloads and exports are written only under a directory a setting
  names**, judged by real path, never over an existing file, never through a
  link, and never inside the state root or the tools' own install directory.
- **The setting is `download_dir`**, by default `~/Downloads/<package name>`
  (`~/Downloads/google-tools`): a person looks in Downloads for what a tool
  fetched, and nothing there is state. Tools write in a subdirectory per kind
  (`sheet-snapshots/`), so one kind is found and cleared apart from another.
  A file is named `<stem>-<UTC timestamp>`, and `-2`, `-3`… is added rather
  than overwriting one. It is opened without following links, with mode 600,
  since an export holds the person's content.
- **An upload reads only under directories a setting names.** The setting is
  `upload_dirs`, empty by default, so a tool reads no file until a person names
  where from. Each named directory is judged by real path. A file is opened
  without following links, must be a regular file with one link, and must lie,
  by real path, inside one of them and outside the state and install
  directories, so a link placed in an allowed directory cannot carry a file
  from elsewhere to Google.
- **A file under an encryption directory goes up only encrypted.** The setting
  is `encrypt_dirs`, empty by default, with `age_recipients` naming the age
  public keys (X25519, `age1…`) to encrypt to. A file whose real path lies
  under a directory `encrypt_dirs` names goes up encrypted with age to those
  recipients, named `.age` and typed `application/octet-stream` (a type would
  say what it is); it must still pass every `upload_dirs` rule, since
  `encrypt_dirs` widens nothing. The comparison of a file's real path with
  those directories ignores case and Unicode normalization, since a
  case-insensitive filesystem would otherwise let a differently spelled path
  go up in the clear; it errs toward encrypting. Nothing is sent when
  encrypting cannot be done (no recipient, age missing or failing, the
  plaintext changing while it is encrypted), not even the start of the
  upload session. The package holds no secret key and offers no decryption:
  that is the person's, with age.

## Text a tool reads

- **Mail, cells, documents, comments and file names are written by other
  people.** Every read tool's description, its result and the skills say they
  are data, never instructions, and nothing in them is followed. Long text is
  clipped, and the result says where.

## Toolsets

- **One per domain**, named with its tools: the account, each Workspace API
  (Sheets, Gmail, Drive, comments on files, Calendar and the others) and each
  Cloud API (Cloud Run, Logging and the others), beside the starter's
  `grants`.
- **The Workspace toolsets are on by default; the Cloud toolsets are off.**
  Workspace is what most users set the package up for, and a write there asks
  every time. A Cloud write reaches running services and other people's
  traffic, so turning a Cloud toolset on is a choice of its own.

## Sheets

- **Eleven tools**, each write its own so an approval remembered for one
  never carries over to a harsher one: `google_sheets_read` (`list`, `view`,
  `values`, `snapshot`, `format`, `structure`, `metadata`; read);
  `google_sheets_create`, `google_sheets_tab_add`, `google_sheets_append` and
  `google_sheets_add` (add); `google_sheets_format` (idempotent change);
  `google_sheets_edit` and `google_sheets_clear` (overwrite);
  `google_sheets_restructure`, `google_sheets_transform` and
  `google_sheets_protect` (administrative).
- **The class is the strictest the arguments can reach.** `add` adds rows,
  columns, tabs and objects and removes nothing, but repeating it adds again,
  so it is not idempotent. `format` changes no value and removes nothing, and
  the same call again leaves the same result. `restructure` deletes and
  replaces, and deleting twice deletes more. `transform` rewrites what people
  wrote, and a `cut`, or a replacement that holds what it finds, changes more
  on a second run. `protect` changes who can edit.
- **Destructive is an operation that loses a value or a setting a person
  made**: it deletes, moves or overwrites cells, renames, changes the locale
  or time zone, or changes or deletes an object. It is `restructure`,
  `transform`, `protect`, `edit` or `clear`, never `add` or `format`.
  Replacing a format and inserting rows or columns are not destructive. An
  operation that only adds an object where there is none (`validate`, `filter`)
  stays in `add`, and the tool refuses where one exists.
- **Operation lists are a fixed vocabulary.** `format`, `add`, `restructure`,
  `transform` and `protect` take 1 to 100 `operations`, each an object told
  apart by `op`; an `op` outside the table is refused, naming the ones
  offered. They are never raw Google requests: the tool builds the requests
  from validated arguments, so what the prompt lists is what runs. All
  operations are one `spreadsheets.batchUpdate`, so all land or none does, and
  they name at most 500 ranges in all. Describing, targeting and running plan
  with the same code.
- **The shifting rule.** After a `delete` or `move` on a tab, a
  `restructure` call holds no later operation on that tab: its ranges would
  mean other cells than the prompt shows. It is refused, and the next step
  goes in a call of its own. An `insert` in `add` shifts too, but it only
  adds, and a later operation's range is read as the cells stand by then.
- **`expect` guards a write against moved rows.** It is on `edit`, `clear`,
  `restructure` and `transform`. An item names a single cell (not a range),
  compared as the sheet displays it, trimmed, with booleans as `TRUE` and
  `FALSE`, up to 200 per call. Or it is `{ range, metadata: { key, value? },
along?: rows|columns }`, which holds when the cell's row (or column) carries
  that developer-metadata mark, so a row is found by its mark wherever sorting
  moved it. They are checked right before the write, in the same call, and any
  difference refuses the call as `stale` with `details.differs`, nothing
  written. A header cell and an id cell per row are enough to notice that rows
  were inserted, deleted or sorted. It is not a lock: Google has no revision
  check for values.
- **`before` makes a rewrite undoable.** `edit`, `clear`, `restructure` and
  `transform` return the replaced or removed ranges as formulas, as `edit`
  takes them back. It is within the read budget (below) and is `null`, with
  `before_truncated: true`, when the ranges exceed it or a cell would be
  clipped, since a clipped copy cannot restore what it cut. It holds values
  only: a deleted row, tab or object, a format or a note is not restored from
  it.
- **Pins make an answer hold only for what was shown.** The prompt pins what
  it asked about, so a call whose subject changed after the answer fails as
  `stale` and is asked again: the current values of the cells to be
  overwritten (`edit`, `clear`, and the cells `restructure` and `transform`
  lose), the titles of tabs renamed or deleted, the definitions of the tables,
  rules, validation, filters, views, charts and pivots changed or deleted, the
  notes `transform` sets over, and the protections `protect` changes.
- **Targets are per tab and per spreadsheet**: `<label>/spreadsheets/<id>/sheets/<tab id>`
  for each tab a write changes, `<label>/spreadsheets/<id>` where the change is
  the spreadsheet's own (a rename, locale or time zone, a new tab, a copied
  tab), and `<label>/spreadsheets/new` for a new spreadsheet. A tab id survives
  a rename, so an "always" answer follows the tab.
- **The prompt's facts, per tool** (the words are in `words.ts`, the builders
  in `write-describe.ts` and `protect-facts.ts`): `Overwrites`, `Checks`,
  `Tabs` and `Cells` for `edit` and `clear` (what is there now and how many
  cells are replaced, how many `expect` cells are checked); `Table` and `Rows`
  for `append`; `Tabs` for `create`; `Position` and `Size` for `tab_add`;
  `Tabs`, `Operations` and `Ranges` for `format` and `add`; `Overwrites`,
  `Checks`, `Tabs` and `Operations` for `restructure` and `transform`; and
  `Editors`, `Warning only`, `Tabs` and `Operations` for `protect`. Each
  operation is also a line of the prompt's `Operations` text, in the tool's
  fixed words with the call's values quoted.
- **`protect` names every editor.** The prompt's `Editors` fact lists each
  editor the call leaves, in full, never cut, and says when a protection only
  warns, leaves only the account, or restricts nobody; the result lists every
  protection added or changed as Google reports it, read back, with every
  editor, and `errors` says so when the read-back fails after the write. A
  person decides on who may edit, so the tool never hides one.
- **The `format` read returns no cell value, except the text of a styled
  run.** Rich text styles parts of a cell's text, and a part is named by its
  text, as `transform`'s `rich_text` takes it; a start index alone would
  leave the model to pair it with a `values` read and count UTF-16 units. So
  a cell's runs are listed in `rich_text`'s shape, each with its `start` and
  the text it covers, within the read budget of 2,000 characters a cell. The
  rest of the cell's text, and every other value, stays out of the read.
- **The read budget is 10,000 cells a call and 2,000 characters a cell.** A
  range that loses rows says `truncated: true`, and `clipped_cells` counts the
  cut text cells, so the model never takes a cut for the whole.
- **The snapshot's export URL is undocumented by Google**, so it is checked
  at a real install, not only against the fake. It needs only the Sheets read
  scopes; no Drive content scope is asked for it. A real install showed that
  it always hands the PDF off with one redirect to
  `doc-…-sheets.googleusercontent.com/export/…`, the route's handoff (see
  "The Google client"); the Drive export, which needs no redirect, has none
  of the print options.
- **Marks are read under the read scope too.** Google's developer-metadata
  search accepts only the write scopes, so a label that holds `spreadsheets`
  searches, and one that holds only `spreadsheets.readonly` reads the marks
  of the spreadsheet, its tabs and their rows and columns from the
  spreadsheet itself, with a field mask that takes no cell values, and
  filters them on its own. The answer is the same either way; the second
  reply grows with the tabs' rows and columns, which is the price of reading
  without the right to write.
- **A sort refuses a range under a basic filter.** Google sorts only the
  rows the filter shows and leaves the hidden ones where they are, while it
  reports success, so the rows would no longer be the rows the person sorted.
  A `sort` whose range meets the tab's basic filter is refused, nothing sent,
  naming `filter_clear`.
- **Searching uses `drive.metadata.readonly`**: names and dates, a restricted
  scope that personal use needs no verification for (see "The OAuth client").
  No Drive content scope is asked.
- **The structure read lists pivot tables only on request.** `pivots: true`
  reads every cell of the tabs, which is slow on large tabs, so the default
  leaves `pivots` null and the other structure comes cheap.
- **Not offered**: a named range is not accepted as a range (A1 notation
  only), since a name may point somewhere other than where the prompt shows.
  Slicers, banded ranges outside a table, data sources and anything else
  outside an operation vocabulary above are not offered either: an operation
  outside the vocabulary is refused, and a raw request is never accepted.

## Gmail

- **Eight tools**: `google_gmail_read` (`search`, `message`, `thread`,
  `labels`, `drafts`, `draft`, `attachment`; read); `google_gmail_draft_create`
  and `google_gmail_label_create` (add); `google_gmail_label` (idempotent
  change); `google_gmail_draft_edit` and `google_gmail_trash` (overwrite);
  `google_gmail_send` and `google_gmail_draft_delete` (administrative). Scopes:
  `gmail.readonly` to read; `gmail.send`, `gmail.compose` and `gmail.modify`
  to write, which `--read-only` leaves out.
- **The classes, and why.** `send` is administrative: a mail reaches other
  people and cannot be taken back, and sending twice sends twice.
  `draft_delete` is administrative: Gmail keeps no deleted draft, so it is
  permanent. `draft_edit` replaces the whole message, so it overwrites.
  `trash` loses mail after 30 days, so it overwrites, and `label` with
  `untrash` undoes it. `label` adds and removes labels and a repeat changes
  nothing more, so it is an idempotent change; it never touches `TRASH`,
  `SPAM`, `DRAFT`, `SENT` or `CHAT`. `draft_create` and `label_create` add
  and repeating them adds again.
- **Targets**: `<label>/recipients/<address>` for each recipient of a send
  (lower-cased; `*` when the mail cannot be planned); `<label>/drafts/<id>`
  for a draft changed or deleted, `<label>/drafts/new` for a new one;
  `<label>/labels/<id>` for each label a `label` call adds or removes and
  `<label>/trash` when it takes mail out of the trash, `<label>/labels/new`
  for `label_create`; and, for `trash`, one `<label>/messages/<id>` or
  `<label>/threads/<id>` per item. An "always" answer therefore covers named
  recipients or labels, never mail sent elsewhere.
- **The prompt's facts, per tool** (words in `words.ts`, builders in
  `send-facts.ts`, `draft-facts.ts`, `label-facts.ts`): for a mail (`send`,
  `draft_create`, `draft_edit`) `Outside` (whether it goes beyond the
  account's own domain, and which), `Copies` (how many go as cc and bcc),
  `Reply to` (the subject of the mail answered), `Attachments` (names and
  sizes) and `Size`; `Replaces` for `draft_edit` (the subject and recipient
  count of the draft replaced, as Google holds it); `To` and `Date` for
  `draft_delete`; `Adds`, `Removes`, `Untrash` and `Messages` or `Threads`
  for `label`; `Colors` for `label_create`; and `Count` and `Deleted after`
  for `trash`. A send of a draft shows the draft as Google holds it now.
- **The message text starts with its address lines.** The text section of a
  mail shows `To`, `Cc` and `Bcc` lines (each left out when empty), the
  subject and the body as written. A blind copy is visible to no one but the
  sender, so only there can the person who approves see who receives it in
  which role. A `label` or `trash` prompt lists the date, sender and subject
  of each item (the first 50 for `label`), read from Google, never from the
  arguments.
- **Pins**: the contents of every attachment (one digest of their hashes) and
  the `Message-ID` of the original replied to; a draft's message id, which
  changes with each edit, for `send` of a draft, `draft_edit` and
  `draft_delete`; and the history ids of the mail `trash` moves. A call whose
  subject changed after the answer is `stale` and asked again.
- **A send that Google accepted never fails afterwards.** The result is read
  with what is there: ids Google did not report are empty, and nothing after
  the send can turn it into an error, so a caller never sends twice because
  of one. After an error or timeout without a result, the skill and the tool
  say to look in the Sent mail first. A `trash` call that fails part-way
  returns what was trashed with the failure under `errors`
  (see "Results").
- **Values saved to files** (an attachment) are masked for the label's own
  secrets only; see "The Google client".
- **Bodies are decoded as UTF-8**, whatever charset a message declares, so
  what a model reads does not depend on a charset label that may be wrong.
  The text parts are read, else the HTML turned into text.
- **Not offered, and why.** Permanent deletion needs the full mail scope and
  cannot be undone. Filters and forwarding: a filter can forward every mail to
  an outside address, and nothing in a call shows that. Mailbox settings
  likewise. Renaming and deleting labels wait for a need.
- **Limits**: a search returns up to 50 messages (default 10); a message body
  is read to 20,000 characters and a thread's bodies to 60,000 in all, and the
  result says when it cut (`body_truncated`); an attachment is saved up to
  25 MiB and a mail carries up to 25 MB of attachments (20 files); a mail
  goes to at most 100 recipients in `to`, `cc` and `bcc` together, each once.
  Attachments are read only under `upload_dirs` (see "Files").

## Drive

- **Eight tools**: `google_drive_read` (`search`, `file`, `drives`,
  `download`; read); `google_drive_upload`, `google_drive_folder_create` and
  `google_drive_copy` (add); `google_drive_rename`, `google_drive_move` and
  `google_drive_restore` (idempotent change); `google_drive_trash`
  (overwrite). Each write is its own tool, so an approval remembered for one
  never carries over to a harsher one.
- **The classes, and why.** `upload`, `folder_create` and `copy` add, and
  repeating them adds another item, never replacing one of the same name.
  `rename`, `move` and `restore` change nothing more on a repeat, so they are
  idempotent changes; none loses content (a rename's old name is shown in the
  prompt and renaming back undoes it, and a move names the folders it left).
  `trash` is `overwrite`, hence destructive: Drive deletes what stays in the
  trash after 30 days, and it takes a shared file away from those it is shared
  with; `restore` undoes it. Nothing here is administrative, since nothing
  deletes at once or changes who can reach a file.
- **Scopes**: `drive.readonly` to read (a restricted scope; see "The OAuth
  client"); `drive.file` to write, which `--read-only` leaves out. `drive.file`
  reaches only the files and folders this client created or a person opened
  with it, so the tools can organise their own work and nothing else. A
  write the plan could read but Google refuses answers 403 or 404 depending on
  the item; the tools map both to `forbidden`, saying that these tools change
  only what they created and that nothing was changed, since a 404 here is
  not a missing item (the plan read it). A write checks both scopes before any
  request, since planning it reads with `drive.readonly`.
- **Nothing goes into a shared place and nothing is taken out of one.** An
  item put in a folder takes that folder's permissions, so putting it in a
  shared folder or a shared drive is sharing by another name, which these
  tools never do; taking an item out of one would take it from the people who
  reach it there. So an upload, a new folder, a copy and a move go only into My
  Drive or a folder that is a folder, not in the trash, not in a shared drive,
  owned by the account and reachable by no permission beyond the owner's, and
  a move refuses an item that is in a shared drive or in a shared folder. A
  folder whose permissions cannot be listed, an account whose address is not
  recorded and an item whose parents Google hides all count as shared: hidden
  sharing is sharing. Every page of a folder's permissions is read, up to
  1,000. The refusal is `forbidden` and names the folder.
- **Targets**: `<label>/folders/<id>` for a destination (the real id, so the
  top of My Drive is its own id, not `root`) and `<label>/files/<id>` for each
  item renamed, moved, trashed or restored; a move names both. An upload whose
  plan fails gives `*`. An "always" answer therefore covers named folders or
  items, never a write elsewhere.
- **The prompt's facts, per tool** (words in `words.ts`, builders in
  `upload-facts.ts`, `destination-facts.ts` and `trash-facts.ts`): `From` (the
  file's real path), `Encrypted` (with age to how many recipients, or `no`;
  none while `encrypt_dirs` is unset), `Size` (the plaintext's), `Type` and
  `Already there` (how many files of that name the folder holds) for `upload`;
  `Already there` for `folder_create`; `Source`, `Size` and `Already there`
  for `copy`; `Type` for `rename`; `From` (the folders it leaves) and `Type`
  for `move`, whose headline says so when the item is there already; `Count`,
  `Deleted after` and `Shared` (how many items others reach) for `trash`, and
  `Count` for `restore`, both with a text line per item (name, kind, shared,
  or already in the state asked for) read from Google. Names come from Google,
  never from the arguments.
- **Pins**: the file's SHA-256 (and a digest of the recipients when it is
  encrypted) and the destination's digest for `upload`; the digest of the
  destination folder (its id, drive, trash state and each permission's id,
  role and type) for every tool that has one; the source's `version` for
  `copy`; the item's current name for `rename`; one digest of every folder the
  item is in, with its sharing, for `move`; and one digest of every item's id
  and version for `trash` and `restore`. A call whose subject changed after the
  answer is `stale` and asked again.
- **Uploads are resumable and never half-made.** The tool opens a resumable
  session and streams the file in 8 MiB chunks, up to 2 GiB. The session
  address is a bearer credential: the client validates it and masks it like
  one, and no result or error carries it. The file is hashed as it goes and
  the last chunk is held until the hash of everything sent equals the one the
  prompt pinned; Drive makes the file only when its last byte lands, so a
  file that changed, or ended early, creates nothing and is `stale`. When
  Google takes in fewer bytes than were sent, the next chunk starts where it
  says, up to three times. An encrypted file is encrypted whole first, and when
  encrypting fails, or the plaintext is not the one pinned, not even the
  session is opened. After an error or timeout without a result the tool and
  the skill say to search for the name before uploading again.
- **Downloads and exports.** A file is saved under `drive` in the download
  directory (see "Files"), up to 2 GiB, and the result gives the path, never
  the content. A file of the Google editors is exported, in `export_type` or
  its kind's default, only in the formats Google's table gives that kind
  (`csv` and `tsv` hold a Sheet's first sheet only). Google exports up to
  10 MB; a larger file and a Google Vids file are refused with the way to open
  them (`web_view_link`). A file whose `canDownload` is false is `forbidden`.
  A folder and a shortcut are refused, the latter naming its target.
- **Permissions are read with `permissions.list`**, up to 10 pages of 100,
  with inherited access marked. Google shows the sharing only to people who
  can share the file, so a 403 on the first page is no failure: `access` is
  `null` with a note, and a folder then counts as `shared`, never as private.
- **Not offered, and why.** Changing sharing (permissions, links, ownership)
  would make a file public or reach other people, and nothing in a call shows
  that, so nothing here writes a permission and the route allowlist holds
  none. Permanent deletion and emptying the trash cannot be undone and need
  the full Drive scope. Revisions and shared drive management wait for a need.
  Changing a file the tools did not create is left to `drive.file`, which
  Google refuses.
- **Limits**: a search returns up to 100 files (default 20) and `drives` up
  to 100 (default 50); a file's permissions are listed up to 1,000; `trash` and
  `restore` take up to 100 items, one request each in order (a failure stops
  the call and is reported under `errors`, beside what was changed); an upload
  and a download are up to 2 GiB; an upload's chunk is 8 MiB; a name is 1 to
  500 characters with no control character. Uploads are read only under
  `upload_dirs` and encrypted under `encrypt_dirs` (see "Files").
- **A copy keeps the source's name when `name` is left out.** The prompt counts
  files of the copy's name in the destination even without an explicit name,
  since Drive keeps the name rather than adding a prefix.
- **A folder move checks the destination's ancestors before writing.** A folder
  cannot go inside itself; Google's bare `badRequest` does not explain that
  refusal. The walk follows at most 100 levels, refusing as `invalid_argument`
  if the ancestors cannot be followed within that bound.

## Comments

- **Five tools**: `google_comments_read` (read); `google_comments_add` and
  `google_comments_delete` (administrative); `google_comments_status`
  (idempotent change); `google_comments_edit` (overwrite). Each write is its
  own tool, so an approval remembered for one never carries over to a harsher
  one.
- **The classes, and why.** `add` is administrative: Google emails an
  assignee and every address the text mentions, mail cannot be taken back,
  and adding twice adds twice. `status` is an idempotent change: a thread
  already in the status asked for gets no request, and the result says
  `changed: false`; it sends no text, so nobody is emailed. `edit` is
  `overwrite`: the old text is not kept (the prompt shows it and the result
  returns it as `before`, so calling `edit` again with it undoes the edit),
  and an edit that would mention an address the old text did not is refused,
  so an edit emails nobody. `delete` is administrative: Google keeps no
  deleted comment, and a thread goes with every reply in it, other people's
  included.
- **Scopes**: `spreadsheets.readonly` and `drive.readonly` to read;
  `spreadsheets` and `drive.file` to write, which `--read-only` leaves out.
  Nothing is asked beyond what the drive toolset reads with, so no restricted
  scope is added (see "The OAuth client"). A spreadsheet's comments go
  through the Sheets API's own comments, anchored to one cell; Drive's
  comments API would leave them unanchored in the editor. Any other file goes
  through Drive's comments API, unanchored, where `drive.file` lets the tools
  comment only on the files they created or a person opened with them. A write
  Google refuses there answers 403 or 404, which the tools map to `forbidden`,
  saying so and that nothing was changed. A write checks the scopes it needs
  before any request: the file read, one of the writes, then the write the
  file's kind needs.
- **Who is emailed is the call's first fact.** The assignee and each
  `+address` or `@address` mention in the text are the targets of an `add`
  (`<label>/recipients/<address>`, beside `<label>/files/<id>`), and the prompt
  lists them first, each with its role. Drive's documentation does not say
  whether a mention emails, so the prompt errs toward listing them. An
  "always" answer therefore covers named files and addresses, never mail to
  anyone else.
- **A spreadsheet's write is saved or it is an error.** The tools send the
  change as one `spreadsheets.batchUpdate` and take it as made only when
  Google reports `commentUpdateState` `ALL_SAVED`. Any other state, or none,
  fails as `upstream_error`, saying the change may or may not have been made;
  the tool and the skill say to read the comments before trying again.
- **Only the account's own posts are edited or deleted.** The post is read
  first and checked against Google's own `me` for the reply, never against an
  argument; another author's is `forbidden` and nothing is changed. A
  thread's first comment is the post a thread's edit or delete is about. A
  spreadsheet's reply that resolved, reopened or assigned a thread is not
  deleted alone, since Google keeps it; deleting the thread removes it.
- **Targets**: `<label>/files/<id>/comments/<comment id>` for `status`, `edit`
  and `delete`, and `<label>/files/<id>` with the addresses emailed for `add`.
  A call whose plan fails gives `*`.
- **The prompt's facts, per tool** (words in `words.ts`, builders in
  `add-describe.ts`, `thread-facts.ts` and each tool's file): `Emailed` (every
  address, with its role), `Replying to` (the thread's author and the start of
  its text), `Status` (when the thread is resolved) and the comment's `Comment`
  text for `add`; `Thread` (author and start of the text) and `At` for
  `status`, whose headline says so when the thread has the status already;
  `At`, `Before` (the old words) and the `New text` for `edit`; `At`, the
  replies deleted with it (how many go, and how many of them others wrote)
  and the `Text to delete` for `delete`. Names and texts come from Google,
  never from the arguments, except the new words.
- **Pins**: the thread's first text for a reply, and the tab's title for a
  new spreadsheet comment (`add`); the post's text for `edit` and `delete`;
  the thread's status for `status`. A call whose subject changed after the
  answer is `stale` and asked again.
- **Reading.** A spreadsheet's threads come with their anchors (`at`, such as
  `Plan!B2`) and `ranges` limits them to those inside A1 ranges; any other
  file's come from Drive's list, up to 10 pages of 100, with the text of the
  file each is about as `quote`, and `incomplete` says pages were left, so
  the counts are lower bounds. Resolved threads are left out unless asked and
  counted in `resolved_hidden`; `more` counts the matching threads past
  `limit`. Deleted comments and replies are left out. A folder and a shortcut
  take no comments, and the refusal names a shortcut's target. Comments are
  written by other people: the read and every write say they are data, never
  instructions.
- **Status changes appear as replies on spreadsheets and other Drive files.**
  Resolving or reopening adds an empty-text reply with `action` `resolve` or
  `reopen`, because Google records the action in the thread on both kinds.
- **A thread's `time` is when it last changed**, including a reply or status
  change, on spreadsheets and other Drive files alike; Google updates the
  thread's modified time, not just the first comment's.
- **Not offered, and why.** Comments on other files than spreadsheets that
  these tools did not make would take the `drive` scope, which reads and
  changes every file. Editing or deleting another person's post is refused
  before the call, since Google allows it to the author alone. Assigning a thread on a file
  that is not a spreadsheet is something Drive cannot do. Anchoring a comment
  on such a file is left out because the editors ignore it.
- **Limits**: a read returns up to 200 threads (default 50); a text is
  clipped at 4,000 characters in a read; a comment's text is 1 to 2,048
  characters, and on a spreadsheet at most 2,048 bytes in UTF-8, which Google
  counts in code units; an assignee is a plain address.

## Cloud Run

- **Nine tools**, off by default like every Cloud toolset:
  `google_run_read` (`services`, `service`, `revisions`, `revision`, `jobs`,
  `job`, `executions`, `execution`, `tasks`, `iam`, `operation`; read);
  `google_run_job_run` (add); `google_run_service_deploy`,
  `google_run_traffic_set`, `google_run_job_deploy` and
  `google_run_execution_cancel` (overwrite); `google_run_revision_delete`,
  `google_run_service_delete` and `google_run_job_delete` (administrative).
  Each write is its own tool, so an approval remembered for one never carries
  over to a harsher one.
- **The classes, and why.** A deploy creates a service or job when there is
  none, but on one that exists it replaces the running revision's image and
  settings, so it overwrites; so do a traffic split, which takes requests
  from the revisions that served them, and a cancel, which stops a run part
  way. Running a job starts another execution on every call, so it adds.
  Deleting a revision, a service or a job cannot be undone: a service goes
  with every revision and its URL, and a revision deleted can no longer take
  traffic back.
- **Scopes**: `run.readonly` to read, `run` to write, which `--read-only`
  leaves out. `run` also allows `setIamPolicy`, and `cloud-platform` would
  allow every Cloud API, so the route allowlist, not the scope, is what keeps
  the tools to the operations below; `cloud-platform` is never asked.
- **Every call names its project and region.** `project` is a project id
  (6 to 30 lowercase letters, digits and hyphens, starting with a letter) and
  `region` a Cloud Run region such as `asia-northeast1`; there is no default
  of either, so a call never lands in a project the prompt does not show.
  Services, jobs, revisions, executions and tasks are named by their short
  names, never by a full resource name, and each goes into the path as one
  segment.
- **No environment value is returned.** A plain environment variable may
  hold a credential, and a value in a transcript cannot be taken back. Every
  service, revision, job, execution and task the tools return, the reads' and
  the writes', goes through one view that gives each variable's `name` and
  `kind` (`value`, or `secret` with the secret and version it references),
  never its value. Annotations are left out for the same reason; labels,
  command and args are returned.
- **Images come from the project's own registries.** A deploy's image is
  `<location>-docker.pkg.dev/<project>/…`, `gcr.io/<project>/…` or
  `<us|eu|asia>.gcr.io/<project>/…`, with `<project>` the call's project. Any
  other (Docker Hub, `ghcr.io`, another project's registry) runs someone
  else's code with the service's identity, so the tool's `gate` refuses it
  before anyone is asked. Which repository inside the project a deploy may
  use is the person's to bound: a deploy's `image` bound is a `prefix` at `/`,
  measured as the image's repository path with its host lowercased and its
  tag or digest left off (`asia-northeast1-docker.pkg.dev/my-proj/apps/api`),
  so a grant of `…/my-proj/apps/api` covers that image at any tag and never
  `…/apps/api-old`.
- **Targets**: `<label>/projects/<project>/locations/<region>/services/<service>`
  for a service and its traffic, `…/jobs/<job>` for a job and its runs,
  `…/services/<service>/revisions/<revision>` for a revision deleted and
  `…/jobs/<job>/executions/<execution>` for an execution cancelled. A grant
  therefore bounds a write to a project, a region and a service or job, and
  a deploy also to the image paths its `image` bound names.
- **A write waits for its operation.** Google answers a change with a
  long-running operation; the tool follows it with `operations.get` up to a
  deadline and returns what changed. One still running at the deadline is
  returned as its operation id with `done: false`, and the read's
  `operation` method follows it; the tool and the skill say to read it before
  trying again. The deadline is 2 minutes, polled every 3 seconds. An
  operation that ends in an error is `upstream_error` with Google's message.
- **A deploy changes only what its arguments name.** On a service that
  exists, the tool reads the service and sends its template back whole with
  `updateMask=template` and the etag it read, changed only in the image and
  the settings the call gives, on the one container it names (`container`,
  needed when there are several). Everything else the template holds is sent
  back as Google gave it, unknown fields included, so a newer setting is never
  dropped; only the fixed revision name is removed, since a new revision needs
  a new one. `forceNewRevision` is set, so deploying the same tag again picks
  up the digest it points to now. The traffic is not touched: a service that
  sends everything to the latest revision serves the new one, and one whose
  traffic is set to revisions keeps it, which the prompt's `Traffic` fact
  says; `google_run_traffic_set` moves it. A service that does not exist is
  created with the image and the settings given, and Google's defaults for
  everything else: invoking needs IAM, the default service account, ingress
  from everywhere. The client masks anything shaped like a Google
  credential in every reply, so a template holding one (a plain variable
  whose value is a key, say) cannot be sent back whole; such a deploy is
  refused, nothing sent, rather than overwrite the value with the mask.
- **Once Google has started a change, the call never reads as if nothing
  happened.** A poll that fails, or a cancellation while waiting, is an
  error that names the operation and says to follow it with the read's
  `operation` method before trying again.
- **An environment variable that references a secret is never set or
  removed.** A deploy that names one is refused, and the prompt shows only
  that a plain variable is set or removed, never its value, which the call's
  arguments already carry.
- **A traffic split is whole.** `google_run_traffic_set` takes every entry
  of the new split (revisions by name, or the latest, with tags), and they
  add up to 100; it replaces the service's traffic with `updateMask=traffic`.
  The prompt shows the traffic served now beside the new split.
- **A job deploy sends the whole job back.** `jobs.patch` takes no update
  mask and replaces the job, so the tool reads the job and sends all of it
  back, labels and unknown fields included, changed only where a service
  deploy would change its container, and in the task count, parallelism,
  retries and task timeout the call gives. The masked-credential refusal
  covers the whole job for the same reason.
- **Running a job does not wait for the run.** Its operation lasts as long
  as the execution, which may be hours, so `google_run_job_run` returns once
  Google has started it, with the execution and the operation, and the read's
  `execution` method follows it. A run's overrides (plain variables, args,
  task count, timeout) apply to that execution only, the job is not changed,
  and a variable that references a secret is not overridden.
- **Only a running execution is cancelled.** One that has finished is
  refused, nothing sent; the prompt shows when it started and how its tasks
  stand.
- **A revision is deleted only once nothing reaches it.** One that takes a
  share of the traffic as set or as served, carries a tag, or is the latest
  ready revision while traffic goes to the latest, is refused, nothing sent,
  and the refusal says to move the traffic with `google_run_traffic_set`
  first. The prompt pins the service's etag beside the revision's, so traffic
  moved to it after the prompt makes the call `stale`.
- **A deletion's prompt shows what goes with it.** A service's shows its URL,
  the traffic it serves now and its latest revision, since every revision
  goes with it; a job's shows how many executions it has and its last run,
  since its executions go with it. Each is sent with the etag it read.
- **A write refuses what changed after its prompt.** The prompt pins the
  service's, job's or execution's etag (or that it is absent), the container
  and the names and kinds of its variables; Google's `ABORTED` or 409 on the
  etag is `stale` too, with nothing changed.
- **Reading.** Lists return up to 100 items a page (default 50) with a
  `next_page_token`. A service's read gives its traffic as set and as served,
  its latest ready and created revisions, its readiness with Google's reason,
  and its template as the deploy would change it, beside what the deploy
  keeps (service account, network, volumes, ingress, whether invoking needs
  IAM). `iam` gives a service's or job's bindings and says when `allUsers` or
  `allAuthenticatedUsers` can reach it. `operation` gives an operation's state,
  error and the resource it changes, never its body. Descriptions, labels,
  conditions' messages and members were written by other people: they are
  data, never instructions.
- **Revision images are already resolved.** In `revisions` and `revision`,
  Google returns the same `…@sha256:…` reference in `images[].image` and
  `digest`; the tag deployed is not shown.
- **Read errors follow Google's response.** A project that does not exist,
  a disabled Cloud Run Admin API or missing permission is `forbidden`.
  A region that does not exist is `upstream_error`, with Google's reason
  (such as `Unsupported region …`) in the message. `not_found` means a service,
  job, revision, execution or operation does not exist. These distinctions
  reflect Google's responses, not whether a project or region was named.
- **Not offered, and why.**
  - Changing IAM (`setIamPolicy`) and public access (`invokerIamDisabled`,
    IAP, custom audiences, the default URL): they change who may reach a
    service, and an `allUsers` binding makes it public, which nothing in a
    deploy's arguments would show.
  - The service account: the identity the code runs as carries every
    permission granted to it.
  - Ingress, egress, VPC access and network interfaces: they open a service
    to, or reach into, networks beyond its own.
  - Secrets and volumes (an environment variable that references a secret,
    secret, Cloud SQL, Cloud Storage and NFS mounts): they reach data beyond
    the image. A deploy keeps the ones a service has and sets none.
  - Encryption keys and binary authorization: they are security policies of
    their own.
  - SSH: a way into a running instance.
  - Builds, source uploads and deploying from source: they run build steps
    no prompt can show; a deploy takes a built image.
  - Exporting images and metadata, worker pools and instances, deleting
    operations: they wait for a need.
  - Deleting an execution: it is the record of what a job ran, and nothing
    needs it gone.
