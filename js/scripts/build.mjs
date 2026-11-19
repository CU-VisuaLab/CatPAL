// Builds dist/ (ESM, CommonJS, and a browser global) with the model data inlined.
import { build } from "esbuild";
import { rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const common = {
  entryPoints: [resolve(root, "src/index.js")],
  bundle: true,
  target: "es2020",
  legalComments: "none",
  logLevel: "warning",
};

rmSync(resolve(root, "dist"), { recursive: true, force: true });
await build({ ...common, minifyWhitespace: true, format: "esm", outfile: resolve(root, "dist/index.mjs") });
await build({ ...common, minifyWhitespace: true, format: "cjs", outfile: resolve(root, "dist/index.cjs") });
await build({ ...common, format: "iife", globalName: "catpal", minify: true,
              outfile: resolve(root, "dist/catpal.global.js") });

console.log("built dist/");
