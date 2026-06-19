const { ethers } = require("ethers");
const crypto = require("crypto");

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

async function sendBnbFromPrivateKey({ fromPrivateKey, toAddress, amount }) {
  if (!fromPrivateKey) throw new Error("Private key is required");
  if (!isBscAddress(toAddress)) throw new Error("Invalid BEP20 address");

  const provider = getProvider();
  const wallet = new ethers.Wallet(fromPrivateKey, provider);

  const tx = await wallet.sendTransaction({
    to: toAddress,
    value: ethers.parseEther(String(amount)),
  });

  const receipt = await tx.wait(1);

  if (!receipt || receipt.status !== 1) {
    throw new Error("BNB transfer failed");
  }

  return tx.hash;
}

async function getUsdtBep20Balance(address) {
  if (!usdtContract) throw new Error("USDT_BEP20_CONTRACT is missing");

  const provider = getProvider();
  const contract = new ethers.Contract(usdtContract, ERC20_ABI, provider);

  const decimals = await contract.decimals();
  const balance = await contract.balanceOf(address);

  return Number(ethers.formatUnits(balance, decimals));
}

const ENCRYPTION_KEY = process.env.WALLET_ENCRYPTION_KEY;

function encryptPrivateKey(privateKey) {
  if (!ENCRYPTION_KEY) {
    throw new Error("WALLET_ENCRYPTION_KEY is required");
  }

  const iv = crypto.randomBytes(12);
  const key = crypto.createHash("sha256").update(ENCRYPTION_KEY).digest();

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(privateKey, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return [
    iv.toString("hex"),
    authTag.toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
}

function createBscWallet() {
  const wallet = ethers.Wallet.createRandom();

  return {
    address: wallet.address,
    privateKey: wallet.privateKey,
    encryptedPrivateKey: encryptPrivateKey(wallet.privateKey),
  };
}

module.exports = {
  isBscAddress,
  sendUsdtBep20FromPrivateKey,
  getBnbBalance,
  getUsdtBep20Balance,
  createBscWallet,
  sendusdtBep20FromPrivateKey,
  sendBnbFromPrivateKey,
};