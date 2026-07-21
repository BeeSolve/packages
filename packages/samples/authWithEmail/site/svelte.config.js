import adapter from "kit-on-lambda";

const originUrl = "https://dwm15mhrb0qh0.cloudfront.net";

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
