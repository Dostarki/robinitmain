const fs = require("fs");
const path = require("path");
const solc = require("solc");
const { ethers } = require("ethers");

const ROOT = path.join(__dirname, "..");
const RPC_URL = "https://rpc.testnet.chain.robinhood.com";
const CHAIN_ID = 46630n;
const TEST_TOKEN = "0xd92989348F779F043336809a375F289B24C3002F";
const INITIAL_ETH_USD_WAD = ethers.parseUnits("2400", 18);
const CURVE_ALLOCATION = ethers.parseUnits("200000000", 18);

function compile() {
  const input = {
    language: "Solidity",
    sources: { "TestIndexCurveV2.sol": { content: fs.readFileSync(path.join(ROOT, "src", "TestIndexCurveV2.sol"), "utf8") } },
    settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
  };
  const result = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (result.errors || []).filter(item => item.severity === "error");
  if (errors.length) throw new Error(errors.map(item => item.formattedMessage).join("\n"));
  return result.contracts["TestIndexCurveV2.sol"].TestIndexCurveV2;
}

async function send(label, txPromise) {
  const tx = await txPromise;
  console.log(`${label} submitted: ${tx.hash}`);
  const receipt = await tx.wait();
  if (receipt.status !== 1) throw new Error(`${label} reverted: ${tx.hash}`);
  return tx.hash;
}

async function main() {
  const privateKey = process.env.TESTNET_PRIVATE_KEY;
  if (!privateKey) throw new Error("TESTNET_PRIVATE_KEY is required");
  const provider = new ethers.JsonRpcProvider(RPC_URL, Number(CHAIN_ID));
  const signer = new ethers.Wallet(privateKey, provider);
  if ((await provider.getNetwork()).chainId !== CHAIN_ID) throw new Error("wrong chain");
  const artifact = compile();
  const factory = new ethers.ContractFactory(artifact.abi, `0x${artifact.evm.bytecode.object}`, signer);
  const curve = await factory.deploy(INITIAL_ETH_USD_WAD);
  await curve.waitForDeployment();
  const curveAddress = await curve.getAddress();
  const token = new ethers.Contract(TEST_TOKEN, ["function transfer(address,uint256) returns (bool)"], signer);
  const deploymentTx = curve.deploymentTransaction();
  await deploymentTx.wait();
  await send("200M TEST transfer to V2", token.transfer(curveAddress, CURVE_ALLOCATION));
  await send("set TEST token", curve.setToken(TEST_TOKEN));
  await send("open V2 sale", curve.setSaleOpen(true));
  console.log(JSON.stringify({ chainId: Number(CHAIN_ID), curve: curveAddress, token: TEST_TOKEN, treasury: await curve.TREASURY(), closeIndexUsd: (await curve.CLOSE_INDEX_USD()).toString() }));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
