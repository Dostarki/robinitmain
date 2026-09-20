const fs = require("fs");
const path = require("path");
const solc = require("solc");

const sourceDir = path.join(__dirname, "..", "src");
const sources = Object.fromEntries(["TestToken.sol", "TestIndexCurveV2.sol"].map(name => [name, { content: fs.readFileSync(path.join(sourceDir, name), "utf8") }]));
const result = JSON.parse(solc.compile(JSON.stringify({ language: "Solidity", sources, settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } } })));
if (result.errors?.some(item => item.severity === "error")) throw Error(result.errors.filter(item => item.severity === "error").map(item => item.formattedMessage).join("\n"));
const artifact = (file, name) => ({ abi: result.contracts[file][name].abi, bytecode: `0x${result.contracts[file][name].evm.bytecode.object}` });
const output = `window.TEST_ADMIN_ARTIFACTS=${JSON.stringify({ token: artifact("TestToken.sol", "TestToken"), curve: artifact("TestIndexCurveV2.sol", "TestIndexCurveV2") })};\n`;
fs.writeFileSync(path.join(__dirname, "..", "app", "admin-artifacts.js"), output);
