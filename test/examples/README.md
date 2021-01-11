# Test Examples

These are some example files that are are used in e2e tests. In these tests we
want to assume that our project already contains the files in the
`preexisting/` folder. Then, as a result of a PR or push, we add some new
files, delete some of the preexisiting files, or modify them. If we add any
new gotos, warnings should be triggered.

## Example Contexts

I wanted to be able to debug what info we have available about the incoming
PR or push event. The files `PR_context.json` and `push_context.json` contain
the result from running

```
- name: Dump GitHub context
  env:
    GITHUB_CONTEXT: ${{ toJson(github) }}
  run: echo "$GITHUB_CONTEXT"
```

as triggered from a [PR event](https://github.com/NickCrews/gotoraptor/pull/38) and
from a [push event](https://github.com/NickCrews/gotoraptor/actions/runs/478289872).

These jsons contain info on the event that happened. Many (but not all) of
these fields are accessible within the
[`require(@actions/github).context`](https://github.com/actions/toolkit/blob/1cc56db0ff126f4d65aeb83798852e02a2c180c3/packages/github/src/context.ts).
It looks like the entire `event` field of the jsons is contained in
`github.context.payload` (they decided to rename event as payload? annoying).
That looks like it is useful.
