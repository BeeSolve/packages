import adapter from "kit-on-lambda";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({ out: "dist/build" }),
  },
};

export default config;
