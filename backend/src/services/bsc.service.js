const { ethers } = require("ethers");

const rpcUrl = process.env.BSC_RPC_URL;
const usdtContract = process.env.USDT_BEP20_CONTRACT;

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

function getProvider() {
  if (!rpcUrl) throw new Error("BSC_RPC_URL is missing");
  return new ethers.JsonRpcProvider(rpcUrl);
}

function isBscAddress(address) {
  return ethers.isAddress(address);
}

async function sendUsdtBep20FromPrivateKey({ fromPrivateKey, toAddress, amount }) {
  if (!fromPrivateKey) throw new Error("Private key is required");
  if (!isBscAddress(toAddress)) throw new Error("Invalid BEP20 address");
  if (!usdtContract) throw new Error("USDT_BEP20_CONTRACT is missing");

  const provider = getProvider();
  const wallet = new ethers.Wallet(fromPrivateKey, provider);
  const contract = new ethers.Contract(usdtContract, ERC20_ABI, wallet);

  const decimals = await contract.decimals();
  const value = ethers.parseUnits(String(amount), decimals);

  const tx = await contract.transfer(toAddress, value);
  const receipt = await tx.wait(1);

  if (!receipt || receipt.status !== 1) {
    throw new Error("BEP20 transaction failed");
  }

  return tx.hash;
}

async function getBnbBalance(address) {
  const provider = getProvider();
  const balance = await provider.getBalance(address);
  return Number(ethers.formatEther(balance));
}

async function getUsdtBep20Balance(address) {
  if (!usdtContract) throw new Error("USDT_BEP20_CONTRACT is missing");

  const provider = getProvider();
  const contract = new ethers.Contract(usdtContract, ERC20_ABI, provider);

  const decimals = await contract.decimals();
  const balance = await contract.balanceOf(address);

  return Number(ethers.formatUnits(balance, decimals));
}

module.exports = {
  isBscAddress,
  sendUsdtBep20FromPrivateKey,
  getBnbBalance,
  getUsdtBep20Balance,
};