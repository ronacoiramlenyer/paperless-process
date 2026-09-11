// Bundles src/pdf-core.js (which imports the npm `pdf-lib` package) into a
// single self-contained Apps Script file. Apps Script has no npm/module
// system, so this is the one build step the GAS project needs - everything
// else is plain .js/.html files pushed as-is via clasp.
import { build } from "esbuild";
import { writeFileSync, readFileSync } from "node:fs";

await build({
  entryPoints: ["src/pdf-core.js"],
  bundle: true,
  platform: "browser", // picks pdf-lib's ESM build; avoids Node-specific globals (Buffer, require, process) that Apps Script's V8 runtime doesn't provide
  format: "iife",
  target: "es2020",
  outfile: "Pdf.generated.js",
});

const generated = readFileSync("Pdf.generated.js", "utf8");
writeFileSync(
  "Pdf.generated.js",
  `// GENERATED FILE - do not edit by hand. Run \`npm run build\` (bundles src/pdf-core.js via esbuild).\n${generated}`
);

console.log("Built Pdf.generated.js");
