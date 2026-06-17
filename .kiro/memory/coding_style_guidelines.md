---
name: coding_style_guidelines
description: Guidelines for internal code commenting style
metadata:
  type: feedback
---

### Code Commenting Standards (Mandatory)

1.  **Purpose:** Comments must serve to explain _why_ a specific choice was made, especially when deviating from an obvious alternative (trade-off discussion), or explaining complex domain logic that is not immediately apparent from the code structure itself.
2.  **Allowed Contexts:**
    - JSDoc/TypeScript documentation blocks (`/** ... */`) describing function contracts, parameters, and return values.
    - High-level architectural comments detailing non-obvious design choices (e.g., "We chose X over Y because of Z performance characteristic.").
3.  **Prohibited Comments:**
    - No arbitrary line comments (`// This comment is irrelevant`).
    - Do not use comments to shorten variable names or explain obvious code flow (The code must be self-documenting).
4.  **Readability over Annotation:** The goal is for the code's structure, function signatures, and explicit variable names to make the code readable without needing excessive commentary.

This guideline overrides previous implicit assumptions regarding commenting density in all future tasks.
