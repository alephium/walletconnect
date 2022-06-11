import "mocha";
import { expect } from "chai";

import WalletConnectProvider, {
  formatChain,
  isCompatibleChainGroup,
  parseChain,
} from "../src/index";
import { WalletClient } from "./shared";
import {
  groupOfAddress,
  node,
  Account,
  NodeProvider,
  Contract,
  Script,
  verifyHexString,
  verifySignedMessage,
} from "@alephium/web3";
import { PrivateKeyWallet } from "@alephium/web3/test";

const NETWORK_ID = 4;
const CHAIN_GROUP = 2;
const PORT = 22973;
const RPC_URL = `http://127.0.0.1:${PORT}`;

const nodeProvider = new NodeProvider(RPC_URL);
const signerA = new PrivateKeyWallet(
  nodeProvider,
  "a642942e67258589cd2b1822c631506632db5a12aabcf413604e785300d762a5",
);
const signerB = PrivateKeyWallet.Random(nodeProvider);
const signerC = PrivateKeyWallet.Random(nodeProvider);
const ACCOUNTS = {
  a: {
    address: "1DrDyTr9RpRsQnDnXo2YRiPzPW4ooHX5LLoqXrqfMrpQH",
    privateKey: signerA.privateKey,
    group: signerA.group,
  },
  b: {
    address: signerB.address,
    privateKey: signerB.privateKey,
    group: signerB.group,
  },
  c: {
    address: signerC.address,
    privateKey: signerC.privateKey,
    group: signerC.group,
  },
};
const ONE_ALPH = "1000000000000000000";

const TEST_RELAY_URL = process.env.TEST_RELAY_URL
  ? process.env.TEST_RELAY_URL
  : "ws://localhost:5555";

const TEST_APP_METADATA = {
  name: "Test App",
  description: "Test App for WalletConnect",
  url: "https://walletconnect.com/",
  icons: ["https://avatars.githubusercontent.com/u/37784886"],
};

const TEST_WALLET_METADATA = {
  name: "Test Wallet",
  description: "Test Wallet for WalletConnect",
  url: "https://walletconnect.com/",
  icons: ["https://avatars.githubusercontent.com/u/37784886"],
};

const TEST_PROVIDER_OPTS = {
  networkId: NETWORK_ID,
  chainGroup: CHAIN_GROUP,
  rpc: {
    custom: {
      [NETWORK_ID]: RPC_URL,
    },
  },
  client: {
    relayUrl: TEST_RELAY_URL,
    metadata: TEST_APP_METADATA,
  },
};

const TEST_WALLET_CLIENT_OPTS = {
  networkId: NETWORK_ID,
  rpcUrl: RPC_URL,
  privateKey: ACCOUNTS.a.privateKey,
  relayUrl: TEST_RELAY_URL,
  metadata: TEST_WALLET_METADATA,
  submitTx: true,
};

describe("Unit tests", function() {
  const expectedChainGroup0 = 2;
  const expectedChainGroup1 = undefined;

  it("test util functions", () => {
    expect(formatChain(4, expectedChainGroup0)).to.eql("alephium:4/2");
    expect(formatChain(4, expectedChainGroup1)).to.eql("alephium:4/-1");
    expect(isCompatibleChainGroup(2, expectedChainGroup0)).to.eql(true);
    expect(isCompatibleChainGroup(1, expectedChainGroup0)).to.eql(false);
    expect(isCompatibleChainGroup(2, expectedChainGroup1)).to.eql(true);
    expect(isCompatibleChainGroup(1, expectedChainGroup1)).to.eql(true);
    expect(parseChain("alephium:4/2")).to.eql([4, 2]);
    expect(parseChain("alephium:4/-1")).to.eql([4, undefined]);
  });
});

describe("WalletConnectProvider with single chainGroup", function() {
  this.timeout(30_000);

  let provider: WalletConnectProvider;
  let walletClient: WalletClient;
  let walletAddress: string;
  before(async () => {
    provider = new WalletConnectProvider({
      ...TEST_PROVIDER_OPTS,
      chainGroup: groupOfAddress(ACCOUNTS.a.address),
    });
    walletClient = await WalletClient.init(provider, TEST_WALLET_CLIENT_OPTS);
    walletAddress = walletClient.signer.address;
    expect(walletAddress).to.eql(ACCOUNTS.a.address);
    const providerAccounts = await provider.connect();
    expect(providerAccounts.map(a => a.address)).to.eql([walletAddress]);
  });
  after(async () => {
    // disconnect provider
    await Promise.all([
      new Promise<void>(async resolve => {
        provider.on("disconnect", () => {
          resolve();
        });
      }),
      new Promise<void>(async resolve => {
        await walletClient.disconnect();
        resolve();
      }),
    ]);
    // expect provider to be disconnected
    expect(walletClient.client?.session.values.length).to.eql(0);
    expect(provider.connected).to.be.false;
  });
  it("networkChanged", async () => {
    // change to testnet
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        provider.on("networkChanged", chainId => {
          try {
            expect(chainId).to.eql(1);
            expect(provider.networkId).to.eql(1);
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      }),

      new Promise<void>(async (resolve, reject) => {
        try {
          await walletClient.changeChain(1, "https://testnet-wallet.alephium.org");
          resolve();
        } catch (e) {
          reject(e);
        }
      }),
    ]);
    // change back to devnet
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        provider.on("networkChanged", chain => {
          try {
            expect(chain).to.eql(NETWORK_ID);
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      }),

      new Promise<void>(async (resolve, reject) => {
        try {
          await walletClient.changeChain(NETWORK_ID, RPC_URL);
          resolve();
        } catch (e) {
          reject(e);
        }
      }),
    ]);
  });
  it("accountsChanged", async () => {
    const changes: Account[][] = [];
    provider.on("accountsChanged", accounts => {
      changes.push(accounts);
    });
    // change to account c
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        provider.on("accountsChanged", accounts => {
          try {
            if (ACCOUNTS.c.group == ACCOUNTS.a.group) {
              expect(accounts[0].address).to.eql(ACCOUNTS.c.address);
            } else {
              expect(accounts).to.eql([]);
            }
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      }),

      new Promise<void>(async (resolve, reject) => {
        try {
          await walletClient.changeAccount(ACCOUNTS.c.privateKey);

          resolve();
        } catch (e) {
          reject(e);
        }
      }),
    ]);
    // change back to account a
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        provider.on("accountsChanged", accounts => {
          try {
            expect(accounts[0].address).to.eql(ACCOUNTS.a.address);
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      }),
      new Promise<void>(async (resolve, reject) => {
        try {
          await walletClient.changeAccount(ACCOUNTS.a.privateKey);
          resolve();
        } catch (e) {
          reject(e);
        }
      }),
    ]);
  });

  function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  let balance: node.Balance;
  async function checkBalanceDecreasing() {
    delay(500);
    const balance1 = await nodeProvider.addresses.getAddressesAddressBalance(ACCOUNTS.a.address);
    expect(balance1.utxoNum).to.eql(1);
    if (balance1.balance >= balance.balance) {
      checkBalanceDecreasing();
    }
    balance = balance1;
  }

  it("should sign", async () => {
    const accounts = await provider.getAccounts();
    expect(!!accounts).to.be.true;
    expect(accounts[0].address).to.eql(ACCOUNTS.a.address);

    balance = await nodeProvider.addresses.getAddressesAddressBalance(ACCOUNTS.a.address);
    expect(balance.utxoNum).to.eql(1);

    expect(walletClient.submitTx).to.be.true;

    await provider.signTransferTx({
      signerAddress: signerA.address,
      destinations: [{ address: ACCOUNTS.b.address, alphAmount: ONE_ALPH }],
    });
    await checkBalanceDecreasing();

    const greeter = await Contract.fromSource(nodeProvider, "greeter.ral");

    const greeterParams = await greeter.paramsForDeployment({
      signerAddress: signerA.address,
      initialFields: { btcPrice: 1 },
    });
    const greeterResult = await signerA.signDeployContractTx(greeterParams);
    await checkBalanceDecreasing();

    const main = await Script.fromSource(nodeProvider, "greeter_main.ral");
    const mainParams = await main.paramsForDeployment({
      signerAddress: signerA.address,
      initialFields: { greeterContractId: greeterResult.contractId },
    });
    const mainResult = await signerA.signExecuteScriptTx(mainParams);
    await checkBalanceDecreasing();

    const hexString = "48656c6c6f20416c65706869756d21";
    const signedHexString = await signerA.signHexString({
      hexString: hexString,
      signerAddress: signerA.address,
    });
    const message = "Hello Alephium!";
    const signedMessage = await signerA.signMessage({
      message: message,
      signerAddress: signerA.address,
    });
    expect(signedMessage.signature).not.to.eql(signedHexString.signature);
    expect(verifyHexString(hexString, signerA.publicKey, signedHexString.signature)).to.be.true;
    expect(verifySignedMessage(message, signerA.publicKey, signedMessage.signature)).to.be.true;
  });
});

describe("WalletConnectProvider with arbitrary chainGroup", function() {
  this.timeout(30_000);

  let provider: WalletConnectProvider;
  let walletClient: WalletClient;
  let walletAddress: string;
  before(async () => {
    const { chainGroup, ...providerOpts } = TEST_PROVIDER_OPTS;
    provider = new WalletConnectProvider({ chainGroup: -1, ...providerOpts });
    walletClient = await WalletClient.init(provider, TEST_WALLET_CLIENT_OPTS);
    walletAddress = walletClient.signer.address;
    expect(walletAddress).to.eql(ACCOUNTS.a.address);
    const providerAccounts = await provider.connect();
    expect(providerAccounts.map(a => a.address)).to.eql([walletAddress]);
  });
  after(async () => {
    // disconnect provider
    await Promise.all([
      new Promise<void>(async resolve => {
        provider.on("disconnect", () => {
          resolve();
        });
      }),
      new Promise<void>(async resolve => {
        await walletClient.disconnect();
        resolve();
      }),
    ]);
    // expect provider to be disconnected
    expect(walletClient.client?.session.values.length).to.eql(0);
    expect(provider.connected).to.be.false;
  });
  it("networkChanged", async () => {
    // change to testnet
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        provider.on("networkChanged", chainId => {
          try {
            expect(chainId).to.eql(1);
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      }),

      new Promise<void>(async (resolve, reject) => {
        try {
          await walletClient.changeChain(1, "https://testnet-wallet.alephium.org");
          resolve();
        } catch (e) {
          reject(e);
        }
      }),
    ]);
    // change back to devnet
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        provider.on("networkChanged", chain => {
          try {
            expect(chain).to.eql(NETWORK_ID);
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      }),

      new Promise<void>(async (resolve, reject) => {
        try {
          await walletClient.changeChain(NETWORK_ID, RPC_URL);
          resolve();
        } catch (e) {
          reject(e);
        }
      }),
    ]);
  });

  it("accountsChanged", async () => {
    const changes: Account[][] = [];
    provider.on("accountsChanged", accounts => {
      changes.push(accounts);
    });
    // change to account c
    await Promise.all([
      new Promise<void>(async (resolve, reject) => {
        try {
          await walletClient.changeAccount(ACCOUNTS.c.privateKey);

          resolve();
        } catch (e) {
          reject(e);
        }
      }),

      new Promise<void>((resolve, reject) => {
        provider.on("accountsChanged", accounts => {
          try {
            expect(accounts[0].address).to.eql(ACCOUNTS.c.address);
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      }),
    ]);
    // change back to account a
    await Promise.all([
      new Promise<void>(async (resolve, reject) => {
        try {
          await walletClient.changeAccount(ACCOUNTS.a.privateKey);
          resolve();
        } catch (e) {
          reject(e);
        }
      }),

      new Promise<void>((resolve, reject) => {
        provider.on("accountsChanged", accounts => {
          try {
            expect(accounts[0].address).to.eql(ACCOUNTS.a.address);
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      }),
    ]);
  });
});
