---
"@beesolve/dmarc-dashboard": patch
---

Upgrade `kit-on-lambda` to `^0.8.1` and tidy up a few route loaders:

- Gate the entire authenticated nav block on `data.user != null` so nav links only render for signed-in users, with the admin-only links nested inside.
- Parallelize independent data fetches with `Promise.all` in the home page loader (domains + backfill statuses) and the user-edit action (update domains + type).
- Keep the user lookup and its dependent logic inside the `try` block on the user-edit loader so the 404 boundary stays tight.
