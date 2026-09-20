const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const QRCode = require("qrcode");
const { getAddress, verifyMessage } = require("ethers");
const { tokenIcons, fetchTokenMarketData } = require("./risk-metadata");
const { createCreatorService } = require("./risk-creator");
const { KeyPool } = require("./key-pool");
const { RiskAccess } = require("./risk-access");
const { DurableRuntime } = require("./queue/durable-runtime");
const { createGatedFetch } = require("./queue/http-gate");
const gatedFetch = createGatedFetch();
const { startSSE, broadcastProgress, broadcastCompletion, getSSEStats } = require("./queue/sse-stream");
const { findJob, findReport: findQueueReport, getMetricsSummary, auditLog, historyForWallet } = require("./queue/job-repository");
const { cacheInvalidateAsset, getCacheStats } = require("./queue/cache-adapter");

try { process.loadEnvFile(path.join(__dirname, "..", ".env")); }
catch (error) { if (error.code !== "ENOENT") throw Error("Unable to load server environment file"); }

const root = path.join(__dirname, "..", "app");
const webRoot = path.join(root, "web", "dist");
const dataDir = path.join(__dirname, "..", "data");
const configPath = path.join(dataDir, "admin-auth.json");
const keyPath = path.join(dataDir, "admin-auth.key");
const operationsPath = path.join(dataDir, "admin-operations.json");
const riskPath = path.join(dataDir, "risk-analyses.json");
const apiKeysPath = path.join(dataDir, "api-keys.json");
const riskAccessPath = path.join(dataDir, "risk-access.json");
const manifestPath = path.join(webRoot, "manifest.json");
const port = Number(process.env.TEST_PANEL_PORT || 4173);
const ownerAddress = "0xb2F6409cF259B8820a733548f575D5B217ea4cCE".toLowerCase();
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
const challenges = new Map(), tickets = new Map(), sessions = new Map(), riskChallenges = new Map(), riskSessions = new Map(); let goplusTokenCache;

function ensureData() { fs.mkdirSync(dataDir, { recursive: true }); if (!fs.existsSync(configPath)) fs.writeFileSync(configPath, JSON.stringify({ admins: { [ownerAddress]: { role: "owner", totp: null } } }, null, 2), { mode: 0o600 }); if (!fs.existsSync(operationsPath)) fs.writeFileSync(operationsPath, JSON.stringify({ deployments: [], activity: [] }, null, 2), { mode: 0o600 }); if (!fs.existsSync(riskPath)) fs.writeFileSync(riskPath, JSON.stringify({ reports: [] }, null, 2), { mode: 0o600 }); if (!fs.existsSync(apiKeysPath)) fs.writeFileSync(apiKeysPath, JSON.stringify({ keys: [] }, null, 2), { mode: 0o600 }); }
function key() { ensureData(); if (process.env.ADMIN_AUTH_MASTER_KEY) return crypto.createHash("sha256").update(process.env.ADMIN_AUTH_MASTER_KEY).digest(); if (!fs.existsSync(keyPath)) fs.writeFileSync(keyPath, crypto.randomBytes(32), { mode: 0o600 }); return fs.readFileSync(keyPath); }

const keyPool = new KeyPool({
  apiKeysPath,
  keyFn: key,
  env: process.env,
});
const creatorService = createCreatorService({ pool: keyPool, fetcher: gatedFetch, requestTimeoutMs: 120000 });
const creatorRequests = new Map();
const riskAccess = new RiskAccess({ filePath: riskAccessPath });

// ─── Queue System Initialization (Plan Bölüm 3, P1) ────────────────────────
let analysisOrchestrator = null;
if (process.env.DATABASE_URL) {
  const runtime = new DurableRuntime({ hashSalt: key, analyze: analyseRisk, enrich: report => creatorService.enrich(report) });
  runtime.start({ migrate: process.env.QUEUE_AUTO_MIGRATE === '1' }).then(() => {
    analysisOrchestrator = runtime;
    console.log('[Server] Durable analysis queue ready');
  }).catch(() => { console.error('[Server] Queue startup failed; direct analysis is disabled'); runtime.close().catch(() => {}); });
} else console.warn('[Server] DATABASE_URL is required; analysis queue is unavailable');

function loadManifest() { try { return JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch { return null; } }
let cachedManifest = null; let lastManifestLoad = 0;
function manifest() { const now = Date.now(); if (!cachedManifest || now - lastManifestLoad > 30000) { cachedManifest = loadManifest(); lastManifestLoad = now; } return cachedManifest; }
const hashedCache = { "Cache-Control": "public, max-age=31536000, immutable" };
const htmlCache = { "Cache-Control": "public, max-age=0, must-revalidate" };
const shortCache = { "Cache-Control": "public, max-age=3600" };
const noCache = { "Cache-Control": "no-store" };

function normalize(address) { return getAddress(address).toLowerCase(); }
function id() { return crypto.randomBytes(32).toString("base64url"); }
function json(response, status, body) { response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); response.end(JSON.stringify(body)); }
function readBody(request) { return new Promise((resolve, reject) => { let body = ""; request.on("data", chunk => { body += chunk; if (body.length > 64 * 1024) reject(Error("Request too large")); }); request.on("end", () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(Error("Invalid JSON")); } }); }); }
function ensureData() { fs.mkdirSync(dataDir, { recursive: true }); if (!fs.existsSync(configPath)) fs.writeFileSync(configPath, JSON.stringify({ admins: { [ownerAddress]: { role: "owner", totp: null } } }, null, 2), { mode: 0o600 }); if (!fs.existsSync(operationsPath)) fs.writeFileSync(operationsPath, JSON.stringify({ deployments: [], activity: [] }, null, 2), { mode: 0o600 }); if (!fs.existsSync(riskPath)) fs.writeFileSync(riskPath, JSON.stringify({ reports: [] }, null, 2), { mode: 0o600 }); if (!fs.existsSync(apiKeysPath)) fs.writeFileSync(apiKeysPath, JSON.stringify({ keys: [] }, null, 2), { mode: 0o600 }); }
function save(value) { fs.writeFileSync(configPath, JSON.stringify(value, null, 2), { mode: 0o600 }); }
function config() { ensureData(); const value = JSON.parse(fs.readFileSync(configPath, "utf8")); if (!value.admins[ownerAddress]) { value.admins[ownerAddress] = { role: "owner", totp: null }; save(value); } return value; }
function operations() { ensureData(); const value = JSON.parse(fs.readFileSync(operationsPath, "utf8")); return { deployments: Array.isArray(value.deployments) ? value.deployments : [], activity: Array.isArray(value.activity) ? value.activity : [] }; }
function saveOperations(value) { fs.writeFileSync(operationsPath, JSON.stringify(value, null, 2), { mode: 0o600 }); }
function riskStore() { ensureData(); const value = JSON.parse(fs.readFileSync(riskPath, "utf8")); return { reports: Array.isArray(value.reports) ? value.reports : [] }; }
function saveRiskStore(value) { fs.writeFileSync(riskPath, JSON.stringify(value, null, 2), { mode: 0o600 }); }
function apiKeyStore() { ensureData(); const value = JSON.parse(fs.readFileSync(apiKeysPath, "utf8")); return { keys: Array.isArray(value.keys) ? value.keys : [] }; }
function saveApiKeyStore(value) { fs.writeFileSync(apiKeysPath, JSON.stringify(value, null, 2), { mode: 0o600 }); }
function providerFromUrl(url) { if (url.includes("gopluslabs")) return "GoPlus"; if (url.includes("rugcheck")) return "RugCheck"; if (url.includes("honeypot.is")) return "Honeypot.is"; if (url.includes("helius")) return "Helius"; if (url.includes("bitquery")) return "Bitquery"; if (url.includes("etherscan")) return "Etherscan"; return "Other"; }
function validNetwork(value) { return value === "mainnet" || value === "testnet"; }
function shortText(value, limit) { return typeof value === "string" && value.trim().length > 0 && value.trim().length <= limit ? value.trim() : null; }
function key() { ensureData(); if (process.env.ADMIN_AUTH_MASTER_KEY) return crypto.createHash("sha256").update(process.env.ADMIN_AUTH_MASTER_KEY).digest(); if (!fs.existsSync(keyPath)) fs.writeFileSync(keyPath, crypto.randomBytes(32), { mode: 0o600 }); return fs.readFileSync(keyPath); }
function encrypt(value) { const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", key(), iv); const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]); return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") }; }
function decrypt(value) { const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(value.iv, "base64")); decipher.setAuthTag(Buffer.from(value.tag, "base64")); return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64")), decipher.final()]).toString("utf8"); }
function base32(bytes) { const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = "", output = ""; for (const byte of bytes) bits += byte.toString(2).padStart(8, "0"); for (let i = 0; i + 5 <= bits.length; i += 5) output += alphabet[parseInt(bits.slice(i, i + 5), 2)]; if (bits.length % 5) output += alphabet[parseInt(bits.slice(bits.length - bits.length % 5).padEnd(5, "0"), 2)]; return output; }
function totp(secret, step = Math.floor(Date.now() / 30000)) { const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = ""; for (const char of secret.replace(/=+$/g, "")) bits += alphabet.indexOf(char).toString(2).padStart(5, "0"); const bytes = Buffer.alloc(Math.floor(bits.length / 8)); for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2); const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step)); const digest = crypto.createHmac("sha1", bytes).update(counter).digest(); const offset = digest[digest.length - 1] & 15; return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, "0"); }
function validTotp(secret, code) { const submitted = Buffer.from(String(code || "").padStart(6, "0")); return [-1, 0, 1].some(offset => crypto.timingSafeEqual(Buffer.from(totp(secret, Math.floor(Date.now() / 30000) + offset)), submitted)); }
function cookieValue(request, name) { const found = (request.headers.cookie || "").split(";").map(part => part.trim()).find(part => part.startsWith(name + "=")); return found ? found.slice(name.length + 1) : null; }
function cookie(request) { return cookieValue(request, "admin_session"); }
function sameOrigin(request) { const origin = request.headers.origin; return !origin || origin === `http://${request.headers.host}` || origin === `https://${request.headers.host}`; }
function session(request) { const token = cookie(request), item = token && sessions.get(token); if (!item || item.expires < Date.now()) { if (token) sessions.delete(token); return null; } return item; }
function requireSession(request, response) { const item = session(request); if (!item) { json(response, 401, { error: "Authentication required" }); return null; } return item; }
function issueSession(response, address) { const token = id(); sessions.set(token, { address, expires: Date.now() + 30 * 60 * 1000 }); const secure = process.env.NODE_ENV === "production" ? "; Secure" : ""; response.setHeader("Set-Cookie", `admin_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800${secure}`); }
function riskSession(request) { const token = cookieValue(request, "risk_session"), item = token && riskSessions.get(token); if (!item || item.expires < Date.now()) { if (token) riskSessions.delete(token); return null; } return item; }
function issueRiskSession(response, address) { const token = id(), secure = process.env.NODE_ENV === "production" ? "; Secure" : ""; riskSessions.set(token, { address, expires: Date.now() + 24 * 60 * 60 * 1000 }); response.setHeader("Set-Cookie", `risk_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${secure}`); }
function createTicket(address, phase) { const token = id(); tickets.set(token, { address, phase, expires: Date.now() + 5 * 60 * 1000 }); return token; }
function getTicket(token, phase) { const item = tickets.get(token); return item && item.phase === phase && item.expires >= Date.now() ? item : null; }
const riskChains = { solana: null, ethereum: "1", bsc: "56", base: "8453", arbitrum: "42161", optimism: "10", polygon: "137" };
function riskAddress(chain, address) { if (!Object.hasOwn(riskChains, chain) || typeof address !== "string") return null; const value = address.trim(); if (chain === "solana") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value) ? value : null; try { return normalize(value); } catch { return null; } }
function clientIp(request) { const forwarded = process.env.TRUST_PROXY === "1" && request.headers["x-forwarded-for"]; return String(forwarded ? String(forwarded).split(",")[0].trim() : request.socket.remoteAddress || "unknown"); }
function privacyHash(value) { return crypto.createHmac("sha256", key()).update(String(value)).digest("base64url"); }
function riskIdentity(request) { const user = riskSession(request); return user && { wallet: privacyHash(user.address), ip: privacyHash(clientIp(request)) }; }
async function riskAccessState(request) { const identity = riskIdentity(request); if (!identity) return null; return analysisOrchestrator ? await analysisOrchestrator.store.access(identity.wallet,identity.ip) : riskAccess.inspect(identity); }
async function upstream(url, headers = {}, body) { const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 120000); try { const response = await gatedFetch(url, { method: body ? "POST" : "GET", headers, body, signal: controller.signal }); if (!response.ok) { throw Error("Upstream " + response.status); } return await response.json(); } catch (error) { throw error; } finally { clearTimeout(timer); } }
async function upstreamPooled(provider, buildUrl) {
  const configured = keyPool.pools.get(provider)?.length > 0;
  if (!configured) return upstream(buildUrl(""));
  for (let attempt = 0; attempt < 3; attempt++) {
    const entry = keyPool.getKey(provider);
    if (!entry) break;
    let status;
    try {
      let token = entry.secret;
      if (entry.kind === "app") token = await goplusToken(entry);
      const response = await gatedFetch(buildUrl(token), {
        // GoPlus currently validates this endpoint with the raw access token; its documented Bearer example returns 4012.
        headers: provider === "GoPlus" ? { Authorization: token } : { Authorization: "Bearer " + token }, redirect: "error", signal: AbortSignal.timeout(120000),
      });
      status = response.status;
      if (!response.ok) throw Error("Provider request failed");
      const body = await response.json();
      if (body.code != null && Number(body.code) !== 1) throw Error("Provider response error");
      keyPool.recordUsage(entry.keyId, true, { status });
      return body;
    } catch {
      keyPool.recordUsage(entry.keyId, false, { status });
      if ([400,401,403].includes(status)) { const error = Error('Provider authorization or request rejected'); error.statusCode = status; throw error; }
    }
  }
  throw Error("No eligible API key or provider unavailable");
}
async function goplusToken(entry) {
  if (goplusTokenCache?.expires > Date.now() && goplusTokenCache.keyId === entry.keyId) return goplusTokenCache.value;
  const time = Math.floor(Date.now() / 1000);
  const sign = crypto.createHash("sha1").update(entry.secret + time + entry.appSecret).digest("hex");
  const payload = await upstream("https://api.gopluslabs.io/api/v1/token", { "Content-Type": "application/json" }, JSON.stringify({ app_key: entry.secret, time, sign }));
  const value = payload?.result?.access_token || payload?.access_token;
  if (!value) throw Error("GoPlus authentication failed");
  goplusTokenCache = { keyId: entry.keyId, value, expires: Date.now() + Math.max(1000, Number(payload?.result?.expires_in || payload?.expires_in || 300) * 1000 - 60000) };
  return value;
}
function truth(value) { return value === true || value === "1" || value === 1; }
function riskLevel(score) { return score >= 70 ? "critical" : score >= 45 ? "high" : score >= 20 ? "moderate" : "low"; }
function safetyLevel(score) { return score >= 80 ? "low" : score >= 55 ? "moderate" : score >= 30 ? "high" : "critical"; }
function signal(list, when, weight, title) { if (when) list.push({ title, weight }); }
function riskCriteria(chain, signals) {
  const catalog = chain === "solana"
    ? [
      ["Mint authority enabled", "A mint authority can create additional supply."],
      ["Freeze authority enabled", "A freeze authority can restrict token-account activity."],
      ["Balance authority enabled", "A privileged authority can alter token-account balances."],
      ["Closable token accounts", "A privileged authority can close token accounts."],
      ["Restricted default account state", "New token accounts can begin in a restricted state."],
      ["Default account state upgradeable", "The default account policy can be changed."],
      ["Transfer fee enabled", "Transfers can carry a token-level fee."],
      ["Transfer fee upgradeable", "A privileged authority can change transfer fees."],
      ["Transfer hook enabled", "Transfers invoke supplementary program logic."],
      ["Transfer hook upgradeable", "Supplementary transfer logic can be changed."],
      ["Non-transferable token", "The token cannot be freely transferred."],
      ["Independent high-risk signal", "The independent Solana validation source returned a high-risk signal."]
    ]
    : [
      ["Honeypot signal", "The primary provider flags potential sell restriction behavior."],
      ["Swap simulation flagged honeypot", "The independent swap simulation indicates a potential honeypot."],
      ["Mint authority enabled", "A privileged role may increase token supply."],
      ["Freeze authority enabled", "A privileged role may freeze balances or transfers."],
      ["Blacklist capability", "The contract has blacklist-related controls."],
      ["Hidden owner", "The contract may retain undisclosed privileged ownership."],
      ["Upgradeable proxy", "Contract logic may be changed after deployment."],
      ["Transfers can be paused", "A privileged role may pause token transfers."],
      ["Source code not verified", "The provider does not report verified source code."],
      ["High buy tax", "The reported buy tax exceeds the review threshold."],
      ["High sell tax", "The reported sell tax exceeds the review threshold."]
    ];
  return catalog.map(([title, note]) => {
    const finding = signals.find(item => item.title === title);
    return { title, note, status: finding ? "warning" : "clear", points: finding?.weight || 0 };
  });
}
function goplusReport(chain, address, data) {
  const source = data?.result?.[address.toLowerCase()] || data?.result?.[address] || data?.result || {};
  const signals = [], add = (when, weight, title) => signal(signals, when, weight, title);
  const flag = value => truth(value?.status ?? value);
  if (chain === "solana") {
    const metadata = source.metadata || {};
    add(flag(source.mintable), 18, "Mint authority enabled");
    add(flag(source.freezable), 15, "Freeze authority enabled");
    add(flag(source.balance_mutable_authority), 16, "Balance authority enabled");
    add(flag(source.closable), 10, "Closable token accounts");
    add(flag(source.default_account_state), 10, "Restricted default account state");
    add(flag(source.default_account_state_upgradable), 8, "Default account state upgradeable");
    add(flag(source.transfer_fee), 8, "Transfer fee enabled");
    add(flag(source.transfer_fee_upgradable), 10, "Transfer fee upgradeable");
    add(flag(source.transfer_hook), 8, "Transfer hook enabled");
    add(flag(source.transfer_hook_upgradable), 10, "Transfer hook upgradeable");
    add(flag(source.non_transferable), 20, "Non-transferable token");
    return { name: metadata.name || source.token_name || source.name || "Unknown token", symbol: metadata.symbol || source.token_symbol || source.symbol || "—", logo: metadata.logo || metadata.image || source.logo_url || source.logo || null, marketCapUsd: Number(source.market_cap || 0) || null, creatorAddress: source.creator_address || null, signals };
  }
  add(truth(source.is_honeypot), 45, "Honeypot signal");
  add(truth(source.is_mintable), 18, "Mint authority enabled");
  add(truth(source.is_freezable), 15, "Freeze authority enabled");
  add(truth(source.is_blacklisted), 18, "Blacklist capability");
  add(truth(source.hidden_owner), 15, "Hidden owner");
  add(truth(source.is_proxy), 8, "Upgradeable proxy");
  add(truth(source.transfer_pausable), 12, "Transfers can be paused");
  add(source.is_open_source !== undefined && !truth(source.is_open_source), 10, "Source code not verified");
  add(Number(source.buy_tax || 0) > 10, 12, "High buy tax");
  add(Number(source.sell_tax || 0) > 10, 16, "High sell tax");
  return { name: source.token_name || source.name || "Unknown token", symbol: source.token_symbol || source.symbol || "—", logo: source.logo_url || source.logo || null, marketCapUsd: Number(source.market_cap || 0) || null, creatorAddress: source.creator_address || null, signals };
}
async function analyseRisk(chain, address) {
  if (!keyPool.hasKeys("GoPlus")) { const error = Error("Risk engine is not configured yet"); error.status = 503; throw error; }
  const goUrl = chain === "solana" ? "https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=" + encodeURIComponent(address) : "https://api.gopluslabs.io/api/v1/token_security/" + riskChains[chain] + "?contract_addresses=" + encodeURIComponent(address);
  const providers = ["GoPlus"], goData = await upstreamPooled("GoPlus", () => goUrl);
  if (goData.code && goData.code !== 1) throw Error("GoPlus analysis unavailable");
  const primary = goplusReport(chain, address, goData), signals = [...primary.signals];

  if (primary.marketCapUsd == null || primary.logo == null) {
    try {
      const market = await fetchTokenMarketData(chain, address, gatedFetch);
      if (market) {
        if (primary.marketCapUsd == null && market.marketCapUsd != null) primary.marketCapUsd = market.marketCapUsd;
        if (!primary.logo && market.logo) primary.logo = market.logo;
        if (primary.name === "Unknown token" && market.name) primary.name = market.name;
        if (primary.symbol === "—" && market.symbol) primary.symbol = market.symbol;
      }
    } catch {}
  }

  if (chain === "solana") {
    let report = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        report = await upstream("https://api.rugcheck.xyz/v1/tokens/" + encodeURIComponent(address) + "/report/summary", { "User-Agent": "Robinity-Risk/1.0" });
        if (report) break;
      } catch {
        if (attempt === 0) await new Promise(r => setTimeout(r, 400));
      }
    }
    if (report) {
      providers.push("RugCheck");
      signal(signals, Number(report.score_normalised || report.score || 0) >= 7000, 15, "Independent high-risk signal");
    }
  } else {
    try {
      const check = await upstream("https://api.honeypot.is/v2/IsHoneypot?address=" + encodeURIComponent(address) + "&chainID=" + riskChains[chain]);
      providers.push("Honeypot.is");
      signal(signals, check?.honeypotResult?.isHoneypot === true, 35, "Swap simulation flagged honeypot");
    } catch {}
  }

  const riskScore = Math.min(100, signals.reduce((total, item) => total + item.weight, 0)), score = 100 - riskScore, report = { id: id(), chain, address, name: primary.name, symbol: primary.symbol, logo: primary.logo, marketCapUsd: primary.marketCapUsd, creatorAddress: primary.creatorAddress, score, riskScore, severity: safetyLevel(score), signals: signals.slice(0, 8), criteria: riskCriteria(chain, signals), providers, analysisVersion: "TEST-SAFETY-v1", analyzedAt: Date.now(), freshness: "live", cached: false };
  return report;
}

function publicTape() { const state = operations(), deployments = new Map(state.deployments.map(item => [item.id, item])); return state.activity.filter(item => item.state === "confirmed").slice(0, 50).map(item => { const deployment = deployments.get(item.deploymentId); return { id: item.id, action: item.action, network: item.network, hash: item.hash || null, at: item.at, deployment: deployment ? { label: deployment.label, tokenSymbol: deployment.tokenSymbol, tokenAddress: deployment.tokenAddress, curveAddress: deployment.curveAddress } : null }; }); }

function publicState() {
  const state = operations();
  const deployments = state.deployments.filter(item => item.network === "mainnet").map(item => ({ id: item.id, label: item.label, tokenSymbol: item.tokenSymbol, network: item.network, tokenAddress: item.tokenAddress, curveAddress: item.curveAddress, updatedAt: item.updatedAt }));
  const confirmed = state.activity.some(item => item.state === "confirmed");
  return { sale: { live: false, source: "admin-verified-deployments" }, deployments, activity: { confirmed } };
}

async function api(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/public/tape") return json(response, 200, { activity: publicTape() });
  if (request.method === "GET" && pathname === "/api/public/state") return json(response, 200, publicState());
  if (request.method === "GET" && pathname === "/api/risk/access/me") {
    const user = riskSession(request); if (!user) return json(response, 200, { connected: false, access: { limit: 3, remaining: 3 } });
    const access = await riskAccessState(request); return json(response, 200, { connected: true, address: user.address, access });
  }
  if (request.method === "POST" && pathname === "/api/risk/access/nonce") {
    if (!sameOrigin(request)) return json(response, 403, { error: "Cross-origin request blocked" });
    const { address } = await readBody(request); let account; try { account = normalize(address); } catch { return json(response, 400, { error: "Connect a valid EVM wallet to continue." }); }
    const challengeId = id(), nonce = id(), issuedAt = new Date().toISOString();
    const message = `Robinity Intelligence Early Access\nDomain: ${request.headers.host}\nAddress: ${account}\nNonce: ${nonce}\nIssued At: ${issuedAt}\nPurpose: Connect this wallet for analysis access. This signature does not authorize a transaction.`;
    riskChallenges.set(challengeId, { account, message, expires: Date.now() + 5 * 60 * 1000 });
    return json(response, 200, { challengeId, message });
  }
  if (request.method === "POST" && pathname === "/api/risk/access/verify") {
    if (!sameOrigin(request)) return json(response, 403, { error: "Cross-origin request blocked" });
    const { challengeId, signature } = await readBody(request), challenge = riskChallenges.get(challengeId); riskChallenges.delete(challengeId);
    if (!challenge || challenge.expires < Date.now()) return json(response, 401, { error: "Connection request expired. Please connect again." });
    let signer; try { signer = normalize(verifyMessage(challenge.message, signature)); } catch { return json(response, 401, { error: "The wallet signature could not be verified." }); }
    if (signer !== challenge.account) return json(response, 401, { error: "The signature does not match the connected wallet." });
    issueRiskSession(response, signer); const identity = { wallet: privacyHash(signer), ip: privacyHash(clientIp(request)) }; return json(response, 200, { connected: true, address: signer, access: analysisOrchestrator ? await analysisOrchestrator.store.access(identity.wallet,identity.ip) : riskAccess.inspect(identity) });
  }
  if (request.method === "POST" && ["/api/risk/creator-analysis", "/api/risk/token-icons", "/api/risk/analyze"].includes(pathname)) {
    return json(response, 410, { error: "Use the queued analysis endpoint." });
  }
  if (request.method === "GET" && pathname === "/api/risk/recent") {
    const user = riskSession(request);
    if (!user) return json(response, 401, { error: "Connect your wallet to view analysis history." });
    if (!analysisOrchestrator) return json(response, 200, { reports: [] });
    return json(response, 200, { reports: await analysisOrchestrator.store.history(privacyHash(user.address)) });
  }
  // ─── Queue-Based Analysis Endpoints (Plan Bölüm 9) ─────────────────────

  // POST /api/risk/analyses — Yeni job oluşturur veya cache/aktif job sonucunu döner
  if (request.method === "POST" && pathname === "/api/risk/analyses") {
    if (!sameOrigin(request)) return json(response, 403, { error: "Cross-origin request blocked" });
    const user = riskSession(request);
    if (!user) return json(response, 401, { error: "Connect your wallet to use early access." });
    const { chain, address } = await readBody(request);
    if (!analysisOrchestrator) {
      // Kuyruk / DB aktif olmadığında yerel test için doğrudan analiz fallback'i
      const identity = riskIdentity(request);
      const currentAccess = riskAccess.inspect(identity);
      if (!currentAccess.allowed) {
        return json(response, 429, { error: "Early access currently allows up to 3 analyses per hour.", access: currentAccess });
      }
      const asset = riskAddress(chain, address);
      if (!asset) return json(response, 400, { error: "Invalid token address or network." });
      try {
        const report = await analyseRisk(chain, asset);
        let insights = null;
        try { insights = await creatorService.enrich(report); } catch {}
        const finalReport = { ...report, insights };
        const nextAccess = riskAccess.consume(identity);
        return json(response, 200, { status: "completed", report: finalReport, access: nextAccess });
      } catch (err) {
        return json(response, err.status || 500, { error: err.message || "Analysis failed" });
      }
    }
    const result = await analysisOrchestrator.submitAnalysis({
      chain,
      address,
      walletAddress: user.address,
      clientIp: clientIp(request),
    });
    return json(response, result.status, result.body);
  }

  // GET /api/risk/analyses/:jobId — Job durumu, progress ve partial/final report
  if (request.method === "GET" && /^\/api\/risk\/analyses\/[\w-]+$/.test(pathname)) {
    const user = riskSession(request);
    if (!user) return json(response, 401, { error: "Connect your wallet to view analysis status." });
    const jobId = pathname.split("/").pop();
    if (!analysisOrchestrator) return json(response, 503, { error: "Analysis queue is not available." });
    const result = await analysisOrchestrator.getJobStatus(jobId, privacyHash(user.address));
    return json(response, result.status, result.body);
  }

  // GET /api/risk/analyses/:jobId/events — SSE progress stream
  if (request.method === "GET" && /^\/api\/risk\/analyses\/[\w-]+\/events$/.test(pathname)) {
    const parts = pathname.split("/");
    const jobId = parts[parts.length - 2];
    const user = riskSession(request);
    if (!user) { response.writeHead(401).end("Authentication required"); return; }
    const walletHash = privacyHash(user.address);
    const started = analysisOrchestrator && await analysisOrchestrator.stream(response, jobId, walletHash, () => !!riskSession(request));
    if (!started) { response.writeHead(403).end("Access denied or job not found"); return; }
    return; // SSE bağlantısı açık kalır
  }

  // GET /api/risk/history — Sadece aktif wallet'ın kendi geçmişi
  if (request.method === "GET" && pathname === "/api/risk/history") {
    const user = riskSession(request);
    if (!user) return json(response, 401, { error: "Connect your wallet to view analysis history." });
    const walletHash = privacyHash(user.address);
    if (!analysisOrchestrator) return json(response, 200, { reports: [] });
    const userReports = await analysisOrchestrator.store.history(walletHash);
    return json(response, 200, { reports: userReports });
  }

  // POST /api/admin/queue/refresh — Owner-only cache refresh/invalidation
  if (request.method === "POST" && pathname === "/api/admin/queue/refresh") {
    const user = requireSession(request, response); if (!user) return;
    if (user.address !== ownerAddress) return json(response, 403, { error: "Only the owner wallet may refresh cache" });
    if (!sameOrigin(request)) return json(response, 403, { error: "Cross-origin request blocked" });
    const { chain, address } = await readBody(request);
    const asset = riskAddress(chain, address);
    if (!asset) return json(response, 400, { error: "Invalid token address or network." });
    try {
      if (!analysisOrchestrator) return json(response, 503, { error: 'Analysis queue unavailable.' });
      await analysisOrchestrator.store.invalidate(chain, asset);
      auditLog(user.address, 'cache_invalidate', `${chain}:${asset}`);
      return json(response, 200, { ok: true, invalidated: `${chain}:${asset}` });
    } catch (err) {
      return json(response, 500, { error: "Cache invalidation failed." });
    }
  }

  // GET /api/admin/queue/stats — Queue operasyonel dashboard (Plan Bölüm 11)
  if (request.method === "GET" && pathname === "/api/admin/queue/stats") {
    const user = requireSession(request, response); if (!user) return;
    try {
      if (!analysisOrchestrator) return json(response, 503, { error: "Analysis queue unavailable." });
      const snapshot = await analysisOrchestrator.snapshot();
      snapshot.sse = getSSEStats();
      return json(response, 200, snapshot);
    } catch (err) {
      return json(response, 200, {
        error: 'Queue system not available (Redis may not be running)',
        cache: getCacheStats(),
        metrics: { last60min: getMetricsSummary(60) },
        timestamp: Date.now(),
      });
    }
  }
  if (request.method === "POST" && pathname === "/api/auth/nonce") { const { address } = await readBody(request); let account; try { account = normalize(address); } catch { return json(response, 400, { error: "Invalid wallet address" }); } const challengeId = id(), nonce = id(), issuedAt = new Date().toISOString(), message = `Robinity Intelligence Admin Access\nDomain: ${request.headers.host}\nAddress: ${account}\nNonce: ${nonce}\nIssued At: ${issuedAt}\nPurpose: Sign in to the Robinity Intelligence admin panel.`; challenges.set(challengeId, { account, message, expires: Date.now() + 5 * 60 * 1000 }); return json(response, 200, { challengeId, message }); }
  if (request.method === "POST" && pathname === "/api/auth/verify-wallet") { const { challengeId, signature } = await readBody(request), challenge = challenges.get(challengeId); challenges.delete(challengeId); if (!challenge || challenge.expires < Date.now()) return json(response, 401, { error: "Sign-in request expired. Start again." }); let signer; try { signer = normalize(verifyMessage(challenge.message, signature)); } catch { return json(response, 401, { error: "Invalid wallet signature" }); } if (signer !== challenge.account) return json(response, 401, { error: "Signature does not match the connected wallet" }); const admin = config().admins[signer]; if (!admin) return json(response, 403, { error: "This wallet is not an admin wallet" }); const phase = admin.totp ? "totp" : "enroll"; return json(response, 200, { phase, ticket: createTicket(signer, phase) }); }
  if (request.method === "POST" && pathname === "/api/auth/totp-setup") { const { ticket } = await readBody(request), item = getTicket(ticket, "enroll"); if (!item) return json(response, 401, { error: "A valid administrator enrollment is required" }); const admin = config().admins[item.address]; if (!admin) return json(response, 403, { error: "This wallet is not an admin wallet" }); if (admin.totp) return json(response, 409, { error: "Authenticator is already enrolled" }); const secret = base32(crypto.randomBytes(20)), uri = `otpauth://totp/Robinity%20Intelligence%20Admin:${item.address}?secret=${secret}&issuer=Robinity%20Intelligence%20Admin&algorithm=SHA1&digits=6&period=30`; item.secret = secret; item.phase = "setup"; const qrDataUrl = await QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 2, width: 260 }); return json(response, 200, { qrDataUrl }); }
  if (request.method === "POST" && pathname === "/api/auth/verify-totp") { const { ticket, code } = await readBody(request), item = getTicket(ticket, "totp") || getTicket(ticket, "setup"); if (!item) return json(response, 401, { error: "Authenticator request expired. Start again." }); const state = config(), admin = state.admins[item.address], secret = item.phase === "setup" ? item.secret : admin?.totp && decrypt(admin.totp); if (!admin || !secret || !validTotp(secret, code)) return json(response, 401, { error: "Invalid authenticator code" }); if (item.phase === "setup") { admin.totp = encrypt(secret); save(state); } tickets.delete(ticket); issueSession(response, item.address); return json(response, 200, { address: item.address, role: admin.role }); }
  if (request.method === "GET" && pathname === "/api/admin/me") { const user = requireSession(request, response); if (!user) return; return json(response, 200, { address: user.address, role: config().admins[user.address].role }); }
  if (request.method === "GET" && pathname === "/api/admins") { const user = requireSession(request, response); if (!user) return; return json(response, 200, { admins: Object.entries(config().admins).map(([address, value]) => ({ address, role: value.role, authenticatorEnrolled: Boolean(value.totp) })) }); }
  if (request.method === "POST" && pathname === "/api/admins") { const user = requireSession(request, response); if (!user) return; if (user.address !== ownerAddress) return json(response, 403, { error: "Only the owner wallet may add administrators" }); const { address } = await readBody(request); let account; try { account = normalize(address); } catch { return json(response, 400, { error: "Invalid wallet address" }); } const state = config(); if (state.admins[account]) return json(response, 409, { error: "Wallet is already an admin" }); state.admins[account] = { role: "admin", totp: null }; save(state); return json(response, 201, { address: account }); }
  if (request.method === "GET" && pathname === "/api/admin/api-keys") {
    if (!requireSession(request, response)) return;
    const keys = keyPool.snapshot();
    return json(response, 200, { keys, poolStatus: keyPool.status(), dailyBudgets: creatorService.usageSnapshot(), observedAt: Date.now(), usageBasis: "Local UTC calendar-month requests, not provider credits", publicProviders: ["RugCheck", "Honeypot.is"] });
  }
  if (pathname.startsWith("/api/admin/api-keys") && request.method !== "GET" && !sameOrigin(request)) return json(response, 403, { error: "Cross-origin request blocked" });
  if (request.method === 'POST' && pathname === '/api/admin/api-keys/settings') {
    const user = requireSession(request, response); if (!user) return;
    if (user.address !== ownerAddress) return json(response, 403, { error: 'Only the owner wallet may change API key settings' });
    const body = await readBody(request), limit = Number(body.monthlyLimit), expiry = body.expiresAt ? Date.parse(body.expiresAt + 'T23:59:59.999Z') : null;
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 100000000 || (expiry !== null && !Number.isFinite(expiry))) return json(response, 400, { error: 'Invalid request budget or expiry date' });
    if (!keyPool.configure(body.id, limit, expiry)) return json(response, 404, { error: 'Key not found' });
    return json(response, 200, { ok: true });
  }
  if (request.method === "POST" && pathname === "/api/admin/api-keys") { const user = requireSession(request, response); if (!user) return; if (!sameOrigin(request)) return json(response, 403, { error: "Cross-origin request blocked" }); if (user.address !== ownerAddress) return json(response, 403, { error: "Only the owner wallet may add API keys" }); const body = await readBody(request), provider = ["GoPlus", "Helius", "Etherscan", "Bitquery"].find(p => p.toLowerCase() === String(body.provider || "").trim().toLowerCase()), label = shortText(body.label, 80), secret = typeof body.secret === "string" ? body.secret.trim() : "", monthlyLimit = Math.max(0, Math.min(100000000, Number(body.monthlyLimit || 0))); if (!provider || !label || secret.length < 8 || secret.length > 2048 || !Number.isFinite(monthlyLimit)) return json(response, 400, { error: "Provider, label and a valid API key are required" }); const expiresAt = body.expiresAt ? Date.parse(body.expiresAt + "T23:59:59.999Z") : null; if (body.expiresAt && !Number.isFinite(expiresAt)) return json(response, 400, { error: "Invalid expiry date" }); const state = apiKeyStore(), now = Date.now(), entry = { id: id(), provider, label, monthlyLimit, expiresAt, masked: `••••${secret.slice(-4)}`, encrypted: encrypt(secret), active: true, requestCount: 0, successCount: 0, createdAt: now, updatedAt: now, createdBy: user.address }; state.keys.unshift(entry); state.keys = state.keys.slice(0, 100); saveApiKeyStore(state); keyPool.reload(); return json(response, 201, { key: { id: entry.id, provider, label, masked: entry.masked, active: true, monthlyLimit, requestCount: 0, createdAt: now } }); }
  if (request.method === "POST" && pathname === "/api/admin/api-keys/rotate") { const user = requireSession(request, response); if (!user) return; if (user.address !== ownerAddress) return json(response, 403, { error: "Only the owner wallet may rotate API keys" }); const body = await readBody(request), secret = typeof body.secret === "string" ? body.secret.trim() : "", state = apiKeyStore(), entry = state.keys.find(item => item.id === body.id); if (!entry || secret.length < 8 || secret.length > 2048) return json(response, 400, { error: "Invalid key or API key id" }); entry.encrypted = encrypt(secret); entry.masked = `••••${secret.slice(-4)}`; entry.requestCount = 0; entry.successCount = 0; entry.lastUsedAt = null; entry.updatedAt = Date.now(); saveApiKeyStore(state); keyPool.reload(); return json(response, 200, { ok: true, masked: entry.masked }); }
  if (request.method === "POST" && pathname === "/api/admin/api-keys/toggle") { const user = requireSession(request, response); if (!user) return; if (user.address !== ownerAddress) return json(response, 403, { error: "Only the owner wallet may change API key state" }); const body = await readBody(request), state = apiKeyStore(), entry = state.keys.find(item => item.id === body.id); if (!entry) return json(response, 404, { error: "API key not found" }); entry.active = !Boolean(entry.active); entry.updatedAt = Date.now(); saveApiKeyStore(state); keyPool.reload(); return json(response, 200, { active: entry.active }); }
  if (request.method === "DELETE" && pathname.startsWith("/api/admin/api-keys/")) { const user = requireSession(request, response); if (!user) return; if (user.address !== ownerAddress) return json(response, 403, { error: "Only the owner wallet may remove API keys" }); const keyId = pathname.split("/").pop(), state = apiKeyStore(), before = state.keys.length; state.keys = state.keys.filter(item => item.id !== keyId); if (state.keys.length === before) return json(response, 404, { error: "API key not found" }); saveApiKeyStore(state); keyPool.reload(); return json(response, 200, { ok: true }); }
  if (request.method === "GET" && pathname === "/api/admin/state") { const user = requireSession(request, response); if (!user) return; const state = operations(); return json(response, 200, { deployments: state.deployments, activity: state.activity }); }
  if (request.method === "POST" && pathname === "/api/admin/deployments") { const user = requireSession(request, response); if (!user) return; const body = await readBody(request); const label = shortText(body.label, 80), tokenSymbol = shortText(body.tokenSymbol, 24), network = body.network; let tokenAddress, curveAddress; try { tokenAddress = normalize(body.tokenAddress); curveAddress = normalize(body.curveAddress); } catch { return json(response, 400, { error: "Invalid token or curve address" }); } if (!label || !tokenSymbol || !validNetwork(network)) return json(response, 400, { error: "Invalid deployment data" }); const state = operations(), existing = typeof body.id === "string" && state.deployments.find(item => item.id === body.id), entry = { id: existing?.id || id(), label, tokenSymbol, network, tokenAddress, curveAddress, createdAt: existing?.createdAt || Date.now(), createdBy: existing?.createdBy || user.address, updatedAt: Date.now() }; if (existing) state.deployments = state.deployments.map(item => item.id === entry.id ? entry : item); else state.deployments.unshift(entry); state.deployments = state.deployments.slice(0, 500); saveOperations(state); return json(response, existing ? 200 : 201, { deployment: entry }); }
  if (request.method === "POST" && pathname === "/api/admin/activity") { const user = requireSession(request, response); if (!user) return; const body = await readBody(request), action = shortText(body.action, 120), stateName = body.state, network = body.network, hash = typeof body.hash === "string" ? body.hash.trim() : "", deploymentId = typeof body.deploymentId === "string" ? body.deploymentId : ""; if (!action || !["pending", "confirmed", "failed"].includes(stateName) || !validNetwork(network) || hash.length > 132) return json(response, 400, { error: "Invalid activity data" }); const state = operations(), existing = typeof body.id === "string" && state.activity.find(item => item.id === body.id && item.actor === user.address), entry = { id: existing?.id || id(), action, state: stateName, network, hash, deploymentId, actor: user.address, at: existing?.at || Date.now(), updatedAt: Date.now() }; if (existing) state.activity = state.activity.map(item => item.id === entry.id ? entry : item); else state.activity.unshift(entry); state.activity = state.activity.slice(0, 2000); saveOperations(state); return json(response, existing ? 200 : 201, { activity: entry }); }
  return json(response, 404, { error: "Not found" });
}

http.createServer(async (request, response) => { const pathname = decodeURIComponent(request.url.split("?")[0]); try { if (pathname.startsWith("/api/")) return await api(request, response, pathname); } catch { return json(response, 500, { error: "Server error" }); } const spaRoute = pathname === "/" || pathname === "/landing" || pathname === "/landing.html" || pathname === "/risk" || pathname === "/risk.html" || pathname === "/intelligence" || pathname === "/admin" || pathname === "/admin.html" || pathname === "/legal" || pathname === "/legal.html" || pathname.startsWith("/legal/") || pathname === "/contact" || pathname === "/methodology" || pathname === "/console" || pathname === "/index.html"; const requested = spaRoute ? "/web/dist/index.html" : pathname, base = spaRoute ? root : root, file = path.resolve(base, `.${requested}`); if (!file.startsWith(root + path.sep)) { response.writeHead(403).end("Forbidden"); return; }   fs.readFile(file, (error, body) => { if (error) { response.writeHead(error.code === "ENOENT" ? 404 : 500).end("Not found"); return; } const ext = path.extname(file); let cacheHeaders = shortCache; if (spaRoute && ext === ".html") { cacheHeaders = htmlCache; } else if (pathname.startsWith("/web/dist/") && ext === ".js" && manifest() && manifest().assets.some(a => pathname === "/web/dist/" + a.name && a.name.endsWith(".js"))) { cacheHeaders = hashedCache; } else if (pathname.startsWith("/web/dist/") && ext === ".css" && manifest() && manifest().assets.some(a => pathname === "/web/dist/" + a.name && a.name.endsWith(".css"))) { cacheHeaders = hashedCache; } else if (spaRoute || pathname.startsWith("/web/dist/")) { cacheHeaders = noCache; } response.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream", ...cacheHeaders }); response.end(body); }); }).listen(port, "127.0.0.1", () => console.log(`Robinity Intelligence panel: http://127.0.0.1:${port}`));
