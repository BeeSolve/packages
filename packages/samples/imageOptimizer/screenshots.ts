import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { testPages, testPagesPrefix } from "./testPages.ts";

const baseUrl = (process.argv[2] ?? process.env.IMAGE_OPTIMIZER_URL ?? "").replace(/\/+$/, "");
const outputDirectory = process.argv[3] ?? "image-optimizer-screenshots";
const viewportWidth = 1400;
const maxViewportHeight = 16384;
const waitForImages = `(async () => {
  await Promise.all([...document.images].map((image) =>
    image.complete && image.src !== "" ? undefined : new Promise((resolve) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", resolve, { once: true });
      setTimeout(resolve, 15000);
    })));
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return true;
})()`;

if (baseUrl === "") {
  console.error(
    "Usage: bun imageOptimizer/screenshots.ts https://<distribution>.cloudfront.net [output dir]",
  );
  process.exit(1);
}

await mkdir(outputDirectory, { recursive: true });
for (const page of Object.keys(testPages())) {
  const url = `${baseUrl}/${testPagesPrefix}/${page}`;
  const height = await pageHeight(url);
  const view = new Bun.WebView({ backend: "chrome", width: viewportWidth, height });
  await view.navigate(url);
  await view.evaluate(waitForImages);
  const screenshot = await view.screenshot({ encoding: "buffer", format: "png" });
  const file = join(outputDirectory, page.replace(".html", ".png"));
  await Bun.write(file, screenshot);
  view.close();
  console.log(`${file} ${viewportWidth}x${height}`);
}
process.exit(0);

async function pageHeight(url: string): Promise<number> {
  const view = new Bun.WebView({ backend: "chrome", width: viewportWidth, height: 1000 });
  await view.navigate(url);
  await view.evaluate(waitForImages);
  const height = await view.evaluate<number>("document.documentElement.scrollHeight");
  view.close();
  return Math.min(maxViewportHeight, Math.max(600, Math.ceil(height)));
}
