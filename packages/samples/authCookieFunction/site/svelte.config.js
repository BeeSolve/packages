import adapter from "kit-on-lambda";

const originUrl = process.env.SAMPLES_AUTH_COOKIE_FUNCTION_FRONTEND_URI;

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter(),
    alias: {
      "$shared/*": "../../shared/*",
    },
    csrf: {
      trustedOrigins: originUrl ? [originUrl] : [],
    },
    paths: {
      assets: originUrl || "",
    },
  },
};

export default config;
