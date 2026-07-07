import adapter from "kit-on-lambda";

const originUrl = "https://d1sgwki4n6dbdp.cloudfront.net";

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
