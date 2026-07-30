import adapter from "kit-on-lambda";

const originUrl = process.env.SAMPLES_AUTH_WITH_EMAIL_FRONTEND_URI;

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter(),
    alias: {
      "$shared/*": "../../shared/*",
    },
    csrf: {
      trustedOrigins: [originUrl],
    },
    paths: {
      assets: originUrl,
    },
  },
};

export default config;
