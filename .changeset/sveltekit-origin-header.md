---
"@beesolve/lambda-fetch-api": minor
---

Use the `Origin` header to derive the request hostname when available, removing the need to manually configure `csrf.trustedOrigins` and `paths.assets` in SvelteKit's `svelte.config.js`.

Narrow the exported `Context` type to `Omit<LambdaContext, "done" | "succeed" | "fail">`, removing long-deprecated callback methods. If your code references `context.done`, `context.succeed`, or `context.fail`, remove those calls — they were already non-functional in modern Lambda runtimes.
