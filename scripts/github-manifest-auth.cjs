/**
 * create-scaffold-hbar reads template.json from api.github.com with no login.
 * A refused request makes it assume Foundry. This adds a token when one exists.
 * It does not change the CLI. Set GITHUB_TOKEN or GH_TOKEN.
 */
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (token && typeof global.fetch === "function") {
  const orig = global.fetch;
  global.fetch = function (url, init) {
    const href = typeof url === "string" ? url : url instanceof URL ? url.href : (url && url.url) || "";
    if (href.startsWith("https://api.github.com/")) {
      const headers = new Headers(init && init.headers);
      if (!headers.has("authorization") && !headers.has("Authorization")) {
        headers.set("authorization", "Bearer " + token);
      }
      init = Object.assign({}, init, { headers });
    }
    return orig.call(this, url, init);
  };
}
