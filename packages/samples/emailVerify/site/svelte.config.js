import adapter from "kit-on-lambda";

const originUrl = "https://d3igjil2lt4iy7.cloudfront.net";

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
