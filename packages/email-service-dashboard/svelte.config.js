import adapter from "kit-on-lambda";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({ out: "dist/build" }),
    // Use absolute asset paths (/_app/...) instead of relative (./_app/...).
    // kit-on-lambda serves routes dynamically, so relative paths resolve
    // against the current route depth (e.g. /domains/_app/...) and 404,
    // stripping styling on nested routes.
    paths: { relative: false },
  },
};

export default config;
