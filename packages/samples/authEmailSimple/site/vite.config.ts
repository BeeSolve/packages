import { resolve } from "node:path";

import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

const sharedDir = resolve(import.meta.dirname, "../../shared");

export default defineConfig({
  plugins: [sveltekit()],
  resolve: {
    alias: {
      $shared: sharedDir,
    },
  },
  server: {
    fs: {
      allow: [sharedDir],
    },
  },
});
