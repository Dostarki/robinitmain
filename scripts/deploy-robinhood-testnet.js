const fs = require("fs");
const path = require("path");
const solc = require("solc");
const { ethers } = require("ethers");

const ROOT = path.join(__dirname, "..");
const RPC_URL = "https://rpc.testnet.chain.robinhood.com";
const CHAIN_ID = 46630n;
const INITIAL_ETH_USD_WAD = ethers.parseUnits("2400", 18);
const CURVE_ALLOCATION = ethers.parseUnits("200000000", 18);

function source(name) {
  return fs.readFileSync(path.join(ROOT, "src", name), "utf8");
}

function compile() {
  const input = {
    language: "Solidity",
    sources: {
      "ChronoIndexCurve.sol": { content: source("ChronoIndexCurve.sol") },
      "TestToken.sol": { content: source("TestToken.sol") },
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const result = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (result.errors || []).filter((entry) => entry.severity === "error");
  if (errors.length) throw new Error(errors.map((entry) => entry.formattedMessage).join("\n"));
  return result.contracts;
}

function artifact(contracts, file, name) {
  const contract = contracts[file][name];
  return { abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}` };
}

async function send(label, transaction) {
  const receipt = await transaction.wait();
  if (receipt.status !== 1) throw new Error(`${label} reverted: ${transaction.hash}`);
  console.log(`${label}: ${transaction.hash}`);
  return receipt;
}

async function main() {
  const privateKey = process.env.TESTNET_PRIVATE_KEY;
  if (!privateKey) throw new Error("TESTNET_PRIVATE_KEY is required");

  const contracts = compile();
  const tokenArtifact = artifact(contracts, "TestToken.sol", "TestToken");
  const curveArtifact = artifact(contracts, "ChronoIndexCurve.sol", "TestIndexCurve");
  const provider = new ethers.JsonRpcProvider(RPC_URL, Number(CHAIN_ID));
  const wallet = new ethers.Wallet(privateKey, provider);
  const network = await provider.getNetwork();
  if (network.chainId !== CHAIN_ID) throw new Error(`wrong chain: ${network.chainId}`);

  console.log(`deployer: ${wallet.address}`);
  console.log(`balance before: ${ethers.formatEther(await provider.getBalance(wallet.address))} ETH`);

  const TestToken = new ethers.ContractFactory(tokenArtifact.abi, tokenArtifact.bytecode, wallet);
  const token = await TestToken.deploy();
  await token.waitForDeployment();
  await send("TEST deployment", token.deploymentTransaction());

  const TestIndexCurve = new ethers.ContractFactory(curveArtifact.abi, curveArtifact.bytecode, wallet);
  const curve = await TestIndexCurve.deploy(INITIAL_ETH_USD_WAD);
  await curve.waitForDeployment();
  await send("curve deployment", curve.deploymentTransaction());

  const curveAddress = await curve.getAddress();
  await send("200M TEST transfer", await token.transfer(curveAddress, CURVE_ALLOCATION));
  await send("set TEST token", await curve.setToken(await token.getAddress()));
  await send("open sale", await curve.setSaleOpen(true));

  const tokenAddress = await token.getAddress();
  const summary = {
    chainId: Number(CHAIN_ID),
    deployer: wallet.address,
    token: tokenAddress,
    curve: curveAddress,
    ethUsdWad: INITIAL_ETH_USD_WAD.toString(),
    curveTestBalance: (await token.balanceOf(curveAddress)).toString(),
    saleOpen: await curve.saleOpen(),
    treasury: await curve.TREASURY(),
  };
  console.log(JSON.stringify(summary));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
