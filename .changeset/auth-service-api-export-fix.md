---
"@beesolve/auth-service": patch
---

Fix `./api` export and publish pipeline.

**`./api` export now ships compiled JavaScript**

Previously the `./api` entry pointed at the raw `api.ts` source file, which failed in standard Node.js environments. It is now built by bunup and exported as `dist/api.js` with a matching `dist/api.d.ts` declaration file, consistent with all other package exports.

**Publish pipeline path corrected**

`dependencies.json` referenced `packages/auth` instead of `packages/service-auth`, causing the CI publish script to fail silently and leave the package unpublished (or published without the prebuilt Lambda zip files). The path is now correct so `prepublishOnly` runs and `dist/api.zip`, `dist/authorizer.zip`, and `dist/sdkHandler.zip` are included in the tarball.
