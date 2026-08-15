---
"@beesolve/dmarc-reports": patch
---

Fix Authentication-Results header parsing for CRLF line endings (real SES emails use `\r\n`, not `\n`)
