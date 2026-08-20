# groundhog

Describe an API test cycle once. Replay it as many times as you like.

Named after the film: you wake up and live the exact same day over again. That
is manual API testing.

## The problem

Testing a feature by hand means walking the same sequence every time. Log in.
Ask for an upload URL. Push the file. Wait for the job to finish. Save the
record. Check it came back. Check the notification fired.

Six requests, each one feeding the next. Do it again tomorrow and you retype
every payload, invent a fresh email because the last one is taken, and copy an
id out of one response into the next by hand. Then a test fails and you cannot
reproduce it, because you no longer know which values you used.

## The idea

Write the cycle down once, as data:

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

Then run it. Every `{{auto.*}}` value is generated from the run's seed, so a
replay with that seed sends byte-identical payloads. Every `extract` puts a
value into `ctx`, so the next step can use it:

```json
{
  "id": "upload",
  "method": "PUT",
  "url": "{{ctx.uploadUrl}}",
  "needs": ["presign"],
  "body": { "type": "file", "path": "{{asset.pick(meals/)}}" }
}
```

## Rules worth knowing up front

**Literal by default.** What you write is what gets sent. Only `{{...}}` tokens
are generated. There is no field the tool fills in behind your back.

**The tool does not invent steps.** You declare the method, URL, headers, and
payload. It fills in the values you marked and nothing else.

**Same token, same value.** `{{auto.email}}` in step 1 and step 5 is one email,
not two. Need a second: `{{auto.email#2}}`.

**A token that fills a whole field keeps its type.** An extracted array is sent
as an array. Embedded in a longer string, it is stringified. Without that rule,
passing a result between steps quietly sends an array as a quoted string and the
API rejects it — a tool bug that reads like a product bug.

**An unresolved reference stops the step.** A step whose `{{ctx.journalId}}` was
never set is skipped, and the report names the missing reference. It is never
rendered as an empty string, because `DELETE /items/{{ctx.id}}` with no id is a
request against the collection.

## Status

Early development. Nothing here is usable yet beyond the test suite.

| stage | state |
|---|---|
| Engine — generation, path reading, template resolution | in progress |
| Engine — assertions, HTTP, orchestration | not started |
| CLI runner | not started |
| Persistence and web UI | not started |
| Natural-language authoring, semantic assertions | not started |

```bash
npm install
npm test
```

## Design constraints

- **No runtime dependencies.** `fetch`, `FormData`, `AbortSignal.timeout`, and
  `node:http` cover what this needs. A path reader and a seeded generator are a
  few dozen lines each, which is cheaper than the packages that do them.
- **The engine reads no clock.** Generated dates derive from a time anchor
  passed in with the seed. A wall-clock read would make replay produce different
  payloads from the same seed.
- **Secrets are redacted before storage,** not before display. Redacting at
  render time means the real token has already reached the database and every
  export made from it.

Requires Node 20.19 or newer.

## License

MIT
