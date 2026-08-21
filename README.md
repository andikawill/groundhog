<div align="center">

<img src="logo.jpeg" alt="A groundhog holding a clock reading 06:00, ringed by looping arrows" width="520">

# groundhog

**It wakes up. It runs the same day again. It never complains.**

Describe an API test cycle once. Replay it byte for byte, forever.

</div>

> Named after the film, where a man lives the same day over and over until he
> gets it right. That is manual API testing. He at least got to learn piano.

## Status

Early development. The engine and its CLI work; there is no UI yet.

| stage | state |
|---|---|
| Seeded generation, path reading, template resolution | done |
| Assertions, HTTP, run orchestration | done |
| CLI runner | done |
| Persistence and web UI | not started |
| Natural-language authoring, semantic assertions | not started |

Requires Node 20.19 or newer.

```bash
cp .env.example .env
npm install
npx prisma db push
npm test
```

Run a case:

```bash
npm run run-case -- --case examples/food-journal.case.json --env examples/staging.env.json --assets examples/assets
```

Replay a previous run exactly — copy the seed and anchor the CLI printed:

```bash
npm run run-case -- --case examples/food-journal.case.json --env examples/staging.env.json --assets examples/assets --seed abc123 --anchor 2026-08-20T00:00:00.000Z
```

The example env points at a host that does not exist, so the first step fails —
that is the shape of the output, not a working demo. Point `--env` at a file of
your own to run it for real. `--assets` defaults to `assets/`, which is
gitignored so your own fixtures stay out of the repository; the example ships
its own under `examples/assets/`.

`--seed` reproduces every `{{auto.*}}` value; `--anchor` reproduces every generated date.
Both are needed for an identical payload.

## Before

Testing one feature by hand, for the fourth time this week:

1. Log in. Copy the token out of the response.
2. Ask for a presigned upload URL. Paste the token. Send. Copy `uploadUrl` and `key`.
3. `PUT` the file to `uploadUrl`. Send.
4. `GET` the classification. Pending. Send again. Pending. Send again. Done.
5. `POST` the journal entry. Paste `key`. Paste the classification items — no, not as a string, it has to stay an array. Send. Copy the id.
6. `GET` the entry back. Paste the id. Read it.
7. Tomorrow, all of it again, with a new email, because the last one is taken.

Then something fails and you cannot reproduce it, because you no longer know
which values you used.

## After

```bash
npm run run-case -- --case food-journal.case.json --env staging.env.json
```

Same six requests. Fresh values, generated from a seed. When it fails, the seed
and time anchor are printed, and re-running with both sends the identical
payloads:

```bash
npm run run-case -- --case food-journal.case.json --env staging.env.json \
  --seed 8f2a1c --anchor 2026-08-20T00:00:00.000Z
```

Those two use short paths for readability; the runnable form is under
[Status](#status) above.

## How it works

A case is a list of steps. A step is a request you declare in full:

```json
{
  "id": "presign",
  "method": "POST",
  "url": "{{env.API}}/v1/media/presigned-url",
  "headers": { "Authorization": "Bearer {{env.TOKEN}}" },
  "body": {
    "type": "json",
    "value": { "fileName": "{{auto.uuid}}.jpg", "contentType": "image/jpeg" }
  },
  "extract": { "uploadUrl": "$.data.uploadUrl", "fileKey": "$.data.key" },
  "assert": [{ "expr": "status == 200" }]
}
```

`extract` puts values into `ctx`. The next step reads them:

```json
{
  "id": "upload",
  "method": "PUT",
  "url": "{{ctx.uploadUrl}}",
  "needs": ["presign"],
  "body": { "type": "file", "path": "{{asset.pick(meals/)}}" }
}
```

Five namespaces fill the tokens: `{{env.*}}` from the selected environment,
`{{ctx.*}}` from earlier responses, `{{auto.*}}` generated from the run's seed,
`{{pool.*}}` drawn from a list the case declares, and `{{asset.*}}` picked from a
folder of files.

A pool is for values with no shape — dish names, districts — where a generator
would produce something obviously fake:

```json
{ "pools": { "mealName": ["nasi lemak", "roti canai", "char kway teow"] } }
```

Declared once on the case, drawn with `{{pool.mealName}}`, picked by the seed like
everything else.

## Four rules, and the bug each one prevents

**Literal by default.** What you write is what gets sent. Only `{{...}}` tokens
are generated, and the tool never invents a step you did not declare. *Prevents:
debugging a request you did not write.*

**One token, one value.** `{{auto.email}}` in step 1 and step 5 is the same
email. Need a second: `{{auto.email#2}}` — the suffix works on any namespace.
*Prevents: a login step and a lookup step silently disagreeing about which user
they mean.*

**A whole-field token keeps its type.** An extracted array injected as an entire
field stays an array; embedded inside a longer string it is stringified.
*Prevents: sending `"[{...}]"` where the API wants `[{...}]`, then filing a bug
against the API.*

**An unresolved reference stops the step.** A step whose `{{ctx.journalId}}` was
never set is skipped, and the report names the missing reference. *Prevents:
`DELETE /items/{{ctx.id}}` rendering as `DELETE /items/` — a request against the
whole collection.*

## Design constraints

**The engine has no runtime dependencies.** `fetch`, `FormData`,
`AbortSignal.timeout`, and `node:http` cover what it needs; a path reader and a
seeded generator are a few dozen lines each, cheaper to own than to import. The
app around it does take dependencies — Next.js, React, Prisma — because writing
those from scratch would be a worse trade. The rule holds where it earns
something: `lib/engine/` is imported by both the CLI and a route handler, so it
stays free of both.

**The engine reads no clock.** Generated dates derive from a time anchor stored
with the seed. A wall-clock read would make the same seed produce different
payloads, which is most of the point gone.

**Secrets are redacted before storage, not before display.** Redacting at render
time means the real token already reached the database, and every export made
from it.

One exception, stated plainly: a run stopped at a `pause` step has to keep the
values it extracted — including an access token — or it could not be resumed at
all. That state is held apart from the run's own record, is never exported or
logged, and is discarded the moment the run continues or ends. A waiting run
holds live credentials for as long as it waits.

## FAQ

**How is this different from Postman or Newman?**
Newman replays a collection you already built. The difference here is what
happens to the values: they are generated per run from a seed, they flow between
steps by name, and a failed run hands you the seed that reproduces it exactly.
That, and steps can pause for you to look before continuing — the run stops and
waits rather than holding a connection open, so a pause can outlast the process
that started it.

**Why not just write integration tests?**
Write those too. These are the cycles you run against a live environment while
building or verifying a feature — the ones that currently live in a browser tab
and your short-term memory.

**Why generate values instead of using fixtures?**
Because the fixture is already registered. Half of manual API testing is
inventing a new email.

**Why no dependencies?**
Everything imported is a thing to upgrade, audit, and be broken by. The two
libraries this would otherwise need are each about thirty lines.

**Why "groundhog"?**
See above. The alternative was naming it after the thing it does, which would
have been accurate and forgettable.

## License

MIT. The shortest one that works.
