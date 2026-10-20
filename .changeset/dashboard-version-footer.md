---
"@beesolve/analytics-dashboard": patch
"@beesolve/dmarc-dashboard": patch
"@beesolve/email-service-dashboard": patch
---

Add a footer to every dashboard showing "Made with ❤️ by BeeSolve s.r.o." and
the deployed package version (`v<version>`). The version is injected at build
time from each package's `package.json` via a Vite `define` (`__APP_VERSION__`),
so the running UI always reflects which published version is deployed.
