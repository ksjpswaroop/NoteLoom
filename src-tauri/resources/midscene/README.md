# Midscene runner resources

`runner.mjs` is the NoteLoom sidecar entrypoint for `@midscene/computer`.

The npm package itself is **not** vendored here. NoteLoom installs it into:

```text
<app_data>/local-services/midscene/
```

via Settings → Automations → Install Runtime.
