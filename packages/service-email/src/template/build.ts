import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { renderEmail } from "./render.js";

/**
 * Pre-renders all React email templates to static HTML/text JSON files.
 *
 * Call this from your package's build.ts at deploy time. The Lambda handler
 * then loads the JSON files at runtime via a simple fs.readFileSync — no
 * react, react-dom, or @react-email packages are bundled into the Lambda.
 *
 * Each template file must export a default React component with a static
 * `PreviewProps` object whose keys name the runtime placeholder values:
 *
 * ```ts
 * export default function WelcomeEmail(props: Props) { ... }
 * WelcomeEmail.PreviewProps = { name: "Alice", baseUri: "https://example.com" };
 * ```
 *
 * For each template + locale combination a file `<name>_<locale>.json` is
 * written to `outDir` containing `{ html, text }`.
 */
export async function buildTemplates(options: {
  readonly templatesDir: string;
  readonly outDir: string;
  readonly locales: Array<string>;
}): Promise<void> {
  const { templatesDir, outDir, locales } = options;

  await rm(outDir, { force: true, recursive: true });
  await mkdir(outDir, { recursive: true });

  const files = await readdir(templatesDir);
  const templateFiles = files.filter((f) => /\.(tsx|ts|jsx|js)$/.test(f));

  await Promise.all(
    templateFiles.flatMap((filename) =>
      locales.map(async (locale) => {
        const { default: template } = await import(join(templatesDir, filename));
        const previewProps: Record<string, string> = template.PreviewProps ?? {};

        const { html, text } = await renderEmail({
          template,
          props: {
            ...Object.fromEntries(
              Object.keys(previewProps).map((key) => [key, `$$$__${key}__$$$`]),
            ),
            locale,
          },
        });

        const baseName = filename.replace(/\.(tsx|ts|jsx|js)$/, "");
        await writeFile(join(outDir, `${baseName}_${locale}.json`), JSON.stringify({ html, text }));
      }),
    ),
  );
}
