---
"@beesolve/dmarc-dashboard": patch
---

Convert the users-list delete form from a named `?/delete` action to the default form action. Named SvelteKit actions use `?/name` in the URL, and the `/` in the query string is rejected/misrouted by CloudFront in the kit-on-lambda deployment, so the delete button could fail behind CloudFront. Using the default action avoids the issue.
