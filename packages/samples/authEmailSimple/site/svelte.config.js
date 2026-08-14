import adapter from "kit-on-lambda";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter(),
    alias: {
      "$shared/*": "../../shared/*",
    },
  },
};

export default config;
