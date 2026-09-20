const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const projectRoot = path.resolve(__dirname, "..");
const outputDir = path.join(projectRoot, "app", "web", "dist");
const entryPoint = path.join(projectRoot, "app", "web", "src", "main.jsx");

function gzipSize(buffer) { return zlib.gzipSync(buffer).length; }

async function build() {
  // dist is generated output only. Clearing it prevents obsolete split chunks from surviving a deploy.
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  await esbuild.build({
    entryPoints: [entryPoint],
    outdir: outputDir,
    bundle: true,
    minify: true,
    format: "esm",
    splitting: true,
    entryNames: "web-[hash]",
    chunkNames: "chunks/[name]-[hash]",
    assetNames: "assets/[name]-[hash]",
    loader: { ".png": "file" },
    external: ["/assets/*"],
    logLevel: "info"
  });
  const files = fs.readdirSync(outputDir);
  const script = files.find(file => /^web-[A-Z0-9]+\.js$/i.test(file));
  const stylesheet = files.find(file => /^web-[A-Z0-9]+\.css$/i.test(file));
  if (!script || !stylesheet) throw Error("Hashed web entry assets were not generated.");

  // Write HTML shell referencing hashed entry assets.
  const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#14171b"><link rel="icon" href="/assets/robinity-logo.png"><link rel="stylesheet" href="/web/dist/${stylesheet}"><title>Robinity Intelligence</title></head><body><div id="root"></div><script type="module" src="/web/dist/${script}"></script></body></html>`;
  fs.writeFileSync(path.join(outputDir, "index.html"), html);
  fs.writeFileSync(path.join(projectRoot, "app", "web", "index.html"), html);

  // Collect hashed assets with sizes.
  const jsFiles = files.filter(f => /\.js$/i.test(f));
  const cssFiles = files.filter(f => /\.css$/i.test(f));
  const assets = [...jsFiles, ...cssFiles, ...fs.readdirSync(path.join(outputDir, "chunks"), { recursive: true }).filter(f => typeof f === "string").map(f => "chunks/" + f)];
  const manifest = { entry: { js: "/web/dist/" + script, css: "/web/dist/" + stylesheet }, assets: assets.map(name => { const raw = fs.readFileSync(path.join(outputDir, name)); return { name, size: raw.length, gzip: gzipSize(raw) }; }), generatedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  // Performance budget report (gzip). Budget applies to the entry shell; lazy chunks (Three.js scene, admin, intelligence) are excluded per plan §10.
  const entryJs = manifest.assets.find(a => a.name === script);
  const entryCss = manifest.assets.find(a => a.name === stylesheet);
  const lazyJs = manifest.assets.filter(a => a.name.endsWith(".js") && a.name !== script).reduce((sum, a) => sum + a.gzip, 0);
  const BUDGET_JS_KB = 180, BUDGET_CSS_KB = 35;
  console.log("\nBuild performance budget:");
  console.log(`  Entry JS gzip:   ${(entryJs.gzip / 1024).toFixed(1)} KB — budget ${BUDGET_JS_KB} KB`);
  console.log(`  Entry CSS gzip:  ${(entryCss.gzip / 1024).toFixed(1)} KB — budget ${BUDGET_CSS_KB} KB`);
  console.log(`  Lazy chunk JS:   ${(lazyJs / 1024).toFixed(1)} KB (route-scoped; excluded from entry budget)`);
  if (entryJs.gzip > BUDGET_JS_KB * 1024 || entryCss.gzip > BUDGET_CSS_KB * 1024) console.warn("⚠ Entry budget exceeded.");
  console.log("");
}

build().catch(error => { console.error(error); process.exit(1); });
