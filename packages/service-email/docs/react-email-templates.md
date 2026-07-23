# React email templates

This guide covers writing React email templates and sending them with `@beesolve/email-service`. It uses the **pre-build pattern**: templates are rendered to static HTML/text at deploy time, so the Lambda handler never ships React or `@react-email` at runtime.

## Why pre-build?

React, react-dom, and the `@react-email` packages together add several megabytes to a Lambda bundle. That worsens cold-start time and complicates tree-shaking.

The pre-build approach sidesteps this entirely:

1. Your **build script** renders each template + locale combination to `{ html, text }` JSON files.
2. Your **Lambda** imports those JSON files (bundled as tiny strings) and calls `hydrateTemplate()` to fill in runtime values.
3. No React in the Lambda bundle.

See [ADR-001](adr-001-prebuild-templates.md) for the full design rationale.

## Setup

Install the react-email component library alongside this package:

```bash
bun add @react-email/components react
bun add -d @types/react
```

## Writing a template

A template is a standard React function component. Attach a static `PreviewProps` object so the build script knows what placeholder keys to generate.

```tsx
// src/templates/welcome.tsx
import { BaseLayout } from "@beesolve/email-service/templating";
import { Button, Heading, Text } from "@react-email/components";

interface Props {
  name: string;
  baseUri: string;
  locale: string;
}

export default function WelcomeEmail({ name, baseUri }: Props) {
  return (
    <BaseLayout previewText={`Welcome, ${name}`} project={{ name: "My App", baseUri }}>
      {(styles) => (
        <>
          <Heading style={styles.h1}>Welcome aboard!</Heading>
          <Text style={styles.text}>Hi {name}, your account is ready.</Text>
          <Button href={`${baseUri}/app`} style={styles.button}>
            Open app
          </Button>
        </>
      )}
    </BaseLayout>
  );
}

// Keys here become $$$__KEY__$$$ placeholders in the pre-built HTML.
WelcomeEmail.PreviewProps = {
  name: "Alice",
  baseUri: "https://example.com",
  locale: "en",
};
```

### `BaseLayout` props

| Prop                   | Required | Description                                                   |
| ---------------------- | -------- | ------------------------------------------------------------- |
| `previewText`          | yes      | Short preview text shown in email clients                     |
| `project.name`         | yes      | Used in the header and footer notices                         |
| `project.baseUri`      | yes      | Base URL for links                                            |
| `project.logo`         | no       | ReactNode to replace the text name in the header              |
| `children`             | yes      | Function receiving the style object, returns the body content |
| `notice`               | no       | Override the default security notice in the footer            |
| `notificationSettings` | no       | Override the default notification settings footer             |
| `enhanceStyles`        | no       | Extend the default style object with your own tokens          |

### Available react-email components

Use any component from `@react-email/components`:

```tsx
import { Button, Column, Heading, Hr, Link, Row, Section, Text } from "@react-email/components";
```

## Build script

Create a `build.ts` in your package that calls `buildTemplates`. Run it as part of your deploy pipeline before bundling the Lambda.

```ts
// build.ts
import { buildTemplates } from "@beesolve/email-service/templating";
import { join } from "node:path";

await buildTemplates({
  templatesDir: join(__dirname, "src/templates"),
  outDir: join(__dirname, "build"),
  locales: ["en", "fr", "de"],
});
```

This produces files like:

```
build/
  welcome_en.json   { "html": "...", "text": "..." }
  welcome_fr.json
  welcome_de.json
```

`buildTemplates` discovers all `.tsx`/`.ts`/`.jsx`/`.js` files in `templatesDir`, renders each with the component's `PreviewProps` keys as placeholders, and writes one JSON file per locale.

Add the build output to your Lambda bundle but keep it out of version control:

```gitignore
# .gitignore
build/
```

## Loading and hydrating at runtime

In your Lambda, import the pre-built JSON and call `hydrateTemplate()` to replace the placeholder tokens with real runtime values.

```ts
import { hydrateTemplate } from "@beesolve/email-service/templating";
import { Email } from "@beesolve/email-service/sdk";
import welcomeEn from "./build/welcome_en.json";
import welcomeFr from "./build/welcome_fr.json";

const emailClient = new Email();

function getTemplate(locale: string) {
  if (locale === "fr") return welcomeFr;
  return welcomeEn;
}

export async function sendWelcomeEmail(user: { name: string; email: string; locale: string }) {
  const { subject, html, text } = hydrateTemplate({
    template: getTemplate(user.locale),
    subject: "Welcome!",
    props: {
      name: user.name,
      baseUri: process.env.BASE_URI!,
      locale: user.locale,
    },
  });

  await emailClient.sendEmail({
    recipients: [user.email],
    subject,
    html,
    text,
  });
}
```

### Placeholder format

`hydrateTemplate` replaces `$$$__KEY__$$$` tokens in both `html` and `text`. The keys come from the component's `PreviewProps` — any prop name becomes a placeholder.

## Multi-locale workflow

For apps supporting multiple locales, a common pattern is to pre-build all locale variants and choose one at runtime based on the user's preference:

```ts
// src/templates/index.ts
import welcomeCs from "../build/welcome_cs.json";
import welcomeEn from "../build/welcome_en.json";
import welcomePl from "../build/welcome_pl.json";
import welcomeSk from "../build/welcome_sk.json";

const welcomeTemplates: Record<string, { html: string; text: string }> = {
  cs: welcomeCs,
  en: welcomeEn,
  pl: welcomePl,
  sk: welcomeSk,
};

export function loadWelcomeTemplate(locale: string) {
  return welcomeTemplates[locale] ?? welcomeTemplates["en"]!;
}
```

## Inline rendering (without pre-build)

For local development or environments where bundle size is not a concern, use `renderEmail` directly:

```ts
import { renderEmail } from "@beesolve/email-service/templating";
import WelcomeEmail from "./src/templates/welcome";

const { html, text } = await renderEmail({
  template: WelcomeEmail,
  props: { name: "Alice", baseUri: "https://example.com", locale: "en" },
});
```

> **Do not use this in production Lambdas** — it requires React in the bundle, adding ~5MB and significantly worsening cold start.

## Previewing templates locally

Use the `@react-email` CLI to preview templates in the browser:

```bash
bunx email dev --dir src/templates
```

Opens a local server at `http://localhost:3000` where you can inspect each template with its `PreviewProps` values rendered.
