// Test-only preload: neutralize the `server-only` guard so AI modules can run
// under tsx in a Node script (they're normally import-restricted to RSC).
const Module = require("module");
const orig = Module._load;
Module._load = function (request, ...rest) {
  if (request === "server-only") return {};
  return orig.call(this, request, ...rest);
};
