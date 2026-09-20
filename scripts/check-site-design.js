const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('node:assert/strict');
const app = path.join(__dirname,'..','app');
const theme = fs.readFileSync(path.join(app,'site-theme.css'),'utf8');
const palette = Object.fromEntries([...theme.matchAll(/(--ds-[\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map(match=>[match[1],match[2].toLowerCase()]));
for(const [token,value] of Object.entries({'--ds-bg':'#14171b','--ds-surface':'#1e2329','--ds-blue':'#8faac4','--ds-orange':'#dca782','--ds-text':'#e8e5df'})) assert.equal(palette[token],value,'Pastel palette mismatch: '+token);
function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map(n=>parseInt(n,16)/255).map(n=>n<=.04045?n/12.92:Math.pow((n+.055)/1.055,2.4));
  return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
}
for(const [foreground,background] of [['--ds-text','--ds-bg'],['--ds-muted','--ds-surface'],['--ds-blue','--ds-bg'],['--ds-ink','--ds-orange']]) {
  const values = [luminance(palette[foreground]),luminance(palette[background])].sort((a,b)=>b-a);
  assert.ok((values[0]+.05)/(values[1]+.05)>=4.5,'Insufficient text contrast: '+foreground+' / '+background);
}
console.log('PASS pastel palette / core text contrast');
const tokenNames = new Set([...theme.matchAll(/(--ds-[\w-]+)\s*:/g)].map(match=>match[1]));
for(const name of ['landing.html','risk.html','admin.html','index.html','legal.html']) {
  const html = fs.readFileSync(path.join(app,name),'utf8');
  assert.match(html,/<link[^>]*rel="icon"[^>]*href="\/assets\/robinity-logo\.png"/,'Missing brand favicon: '+name);
  assert.match(html,/<link[^>]*href="\/?site-theme\.css"/,'Missing shared theme: '+name);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
  assert.equal(new Set(ids).size,ids.length,'Duplicate IDs: '+name);
  for(const [,attributes,source] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if(!source.trim() || /\bsrc=/.test(attributes)) continue;
    if(/type="module"/.test(attributes)) new vm.SourceTextModule(source,{identifier:name});
    else new vm.Script(source,{filename:name});
  }
  for(const match of html.matchAll(/<link[^>]*href="([^"]+)"[^>]*rel="stylesheet"|<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)) {
    const href = match[1] || match[2];
    if(href && !href.startsWith('https:')) assert.ok(fs.existsSync(path.join(app,href.replace(/^\//,''))),'Missing stylesheet '+href);
  }
  console.log('PASS shared theme / IDs / script syntax: '+name);
}
for(const file of ['console-theme.css','risk-ui/src/brand.css','landing-effects/effects.css','brand-layout.css']) {
  const css = fs.readFileSync(path.join(app,file),'utf8');
  for(const [,token] of css.matchAll(/var\((--ds-[\w-]+)/g)) assert.ok(tokenNames.has(token),'Unknown token '+token+' in '+file);
  assert.match(css,/prefers-reduced-motion/,'Missing reduced-motion treatment '+file);
  console.log('PASS shared token references: '+file);
}
const sceneSource = fs.readFileSync(path.join(app,'landing-effects/src/scene.js'),'utf8');
new vm.SourceTextModule(sceneSource,{identifier:'landing scene'});
assert.ok(fs.existsSync(path.join(app,'landing-effects/dist/scene.js')),'Missing built landing scene');
assert.match(sceneSource,/prefers-reduced-motion/);
assert.match(sceneSource,/IntersectionObserver/);
assert.match(sceneSource,/document\.hidden/);
assert.match(sceneSource,/webglcontextlost/);
console.log('PASS landing scene syntax / bundle / motion safeguards');
const landing = fs.readFileSync(path.join(app,'landing.html'),'utf8');
const footer = landing.match(/<footer\b[\s\S]*?<\/footer>/)[0];
assert.match(footer,/https:\/\/x\.com\/robinityint/);
assert.doesNotMatch(footer,/href="#(?:curve|movement|engagement)"/);
const legal = fs.readFileSync(path.join(app,'legal.html'),'utf8');
for(const id of ['terms','privacy','risks']){assert.ok(footer.includes('/legal.html#'+id));assert.ok(legal.includes('id="'+id+'"'));}
console.log('PASS X profile / legal destinations / non-duplicated footer navigation');
assert.ok(fs.existsSync(path.join(app,'assets/robinity-logo.png')),'Missing supplied logo');
const riskSource=fs.readFileSync(path.join(app,'risk-ui/src/App.jsx'),'utf8');
assert.match(riskSource,/intelligence-watermark/);
assert.match(riskSource,/watermark-glint/);
assert.match(riskSource,/emblem-stage/);
assert.match(riskSource,/aria-hidden="true"/);
console.log('PASS shared logo / favicon / decorative intelligence watermark');
