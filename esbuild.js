const esbuild = require("esbuild");
const watch = process.argv.includes("--watch");
const common = { bundle: true, sourcemap: true, logLevel: "info" };
async function run() {
  const ext = await esbuild.context({
    ...common, entryPoints: ["src/extension.ts"], outfile: "dist/extension.js",
    platform: "node", format: "cjs", external: ["vscode"],
  });
  const web = await esbuild.context({
    ...common, entryPoints: ["src/webview/main.ts"], outfile: "dist/webview.js",
    platform: "browser", format: "iife",
  });
  if (watch) { await ext.watch(); await web.watch(); }
  else { await ext.rebuild(); await web.rebuild(); await ext.dispose(); await web.dispose(); }
}
run();
