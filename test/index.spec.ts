import "mocha";
import { expect } from "chai";

import WalletConnectProvider, {
  formatChain,
  parseChain,
  ChainGroup,
  getPermittedChainGroups,
  getPermittedChainId
} from "../src/index";
import { WalletClient } from "./shared";
import {
  web3,
  node,
  NodeProvider,
  verifyHexString,
  verifySignedMessage,
  Project,
} from "@alephium/web3";
import { PrivateKeyWallet } from "@alephium/web3-wallet";
import { SignClientTypes } from "@walletconnect/types";
import SignClient from "@walletconnect/sign-client";

const NETWORK_ID = 4;
const CHAIN_GROUP = 2;
const PORT = 22973;
const RPC_URL = `http://localhost:${PORT}`;

const nodeProvider = new NodeProvider(RPC_URL);
web3.setCurrentNodeProvider(RPC_URL)
const signerA = new PrivateKeyWallet(
  "a642942e67258589cd2b1822c631506632db5a12aabcf413604e785300d762a5",
);
const signerB = PrivateKeyWallet.Random(1);
const signerC = PrivateKeyWallet.Random(2);
const signerD = PrivateKeyWallet.Random(3);
const ACCOUNTS = {
  a: {
    address: signerA.address,
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
  d: {
    address: signerD.address,
    privateKey: signerD.privateKey,
    group: signerD.group,
  }
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
  logger: "error",
  permittedChains: [{
    networkId: NETWORK_ID,
    chainGroup: CHAIN_GROUP
  }],
  rpc: {
    custom: {
      [NETWORK_ID]: RPC_URL,
    },
  },
  relayUrl: TEST_RELAY_URL,
  metadata: TEST_APP_METADATA,
};

const TEST_WALLET_CLIENT_OPTS = {
  networkId: NETWORK_ID,
  rpcUrl: RPC_URL,
  activePrivateKey: ACCOUNTS.a.privateKey,
  otherPrivateKeys: [ACCOUNTS.b.privateKey, ACCOUNTS.c.privateKey, ACCOUNTS.d.privateKey],
  relayUrl: TEST_RELAY_URL,
  metadata: TEST_WALLET_METADATA,
  submitTx: true,
};

export const TEST_PROJECT_ID = process.env.TEST_PROJECT_ID
  ? process.env.TEST_PROJECT_ID
  : undefined;

export const TEST_SIGN_CLIENT_OPTIONS: SignClientTypes.Options = {
  logger: "error",
  relayUrl: TEST_RELAY_URL,
  projectId: TEST_PROJECT_ID,
  storageOptions: {
    database: ":memory:",
  },
  metadata: TEST_APP_METADATA
};

describe("Unit tests", function() {
  const expectedChainGroup0 = 2;
  const expectedChainGroup1 = 1;

  it("test formatChain & parseChain", () => {
    expect(formatChain(4, expectedChainGroup0)).to.eql("alephium:4/2");
    expect(formatChain(4, expectedChainGroup1)).to.eql("alephium:4/1");
    expect(formatChain(4, -1)).to.eql("alephium:4/-1");
    expect(parseChain("alephium:4/2")).to.eql([4, 2]);
    expect(parseChain("alephium:4/1")).to.eql([4, 1]);
    expect(parseChain("alephium:4/-1")).to.eql([4, -1]);
  });

  it("test getPermittedChainGroups", () => {
    expect(getPermittedChainGroups([])).to.eql({})
    expect(getPermittedChainGroups([
      { networkId: 4, chainGroup: 1 },
      { networkId: 4, chainGroup: 2 },
      { networkId: 4, chainGroup: -1 },
      { networkId: 1, chainGroup: 1 },
      { networkId: 1, chainGroup: 2 },
    ])).to.eql({
      1: [1, 2],
      4: [-1]
    })

    expect(getPermittedChainGroups([
      { networkId: 4, chainGroup: -1 },
      { networkId: 4, chainGroup: 1 },
      { networkId: 2, chainGroup: 2 },
      { networkId: 2, chainGroup: 2 },
      { networkId: 2, chainGroup: 3 },
      { networkId: 4, chainGroup: -1 },
      { networkId: 1, chainGroup: 1 },
      { networkId: 1, chainGroup: 1 },
      { networkId: 1, chainGroup: 2 },
      { networkId: 1, chainGroup: -1 },
    ])).to.eql({
      1: [-1],
      2: [2, 3],
      4: [-1]
    })
  });

  it("test getPermittedChainId", () => {
    expect(getPermittedChainId(4, 1, undefined)).to.eql(undefined)
    expect(getPermittedChainId(4, 1, { 1: [1, 2] })).to.eql(undefined)
    expect(getPermittedChainId(4, 3, { 1: [1, 2], 4: [1, 2] })).to.eql(undefined)
    expect(getPermittedChainId(4, 1, { 1: [1, 2], 4: [1, 2, 3] })).to.eql("alephium:4/1")
    expect(getPermittedChainId(4, 2, { 1: [-1], 4: [1, 2, 3] })).to.eql("alephium:4/2")
    expect(getPermittedChainId(4, 1, { 1: [1, 2], 4: [-1] })).to.eql("alephium:4/-1")
  });
});

describe("WalletConnectProvider with single chainGroup", function() {
  this.timeout(30_000);

  let provider: WalletConnectProvider;
  let walletClient: WalletClient;
  let walletAddress: string;

  before(async () => {
    const signClient = await SignClient.init(TEST_SIGN_CLIENT_OPTIONS);
    provider = new WalletConnectProvider({
      ...TEST_PROVIDER_OPTS,
      client: signClient,
      permittedChains: [
        {
          networkId: NETWORK_ID,
          chainGroup: signerA.group as ChainGroup
        },
        {
          networkId: 1,
          chainGroup: signerA.group as ChainGroup
        },
        {
          networkId: NETWORK_ID,
          chainGroup: signerC.group as ChainGroup
        }
      ]
    });
    walletClient = await WalletClient.init(provider, TEST_WALLET_CLIENT_OPTS);
    walletAddress = walletClient.signer.address;
    expect(walletAddress).to.eql(ACCOUNTS.a.address);
    const providerAccounts = await provider.connect();
    expect(provider.chains).to.eql([
      "alephium:1/0",
      "alephium:4/0",
      "alephium:4/2"
    ])
    expect(providerAccounts.map(a => a.address)).to.eql([
      signerA.address,
      signerC.address
    ]);
  });

  after(async () => {
    // disconnect provider
    await Promise.all([
      new Promise<void>(async resolve => {
        provider.on("disconnect", () => {
          resolve();
        });
      }),
      walletClient.disconnect()
    ]);
    // expect provider to be disconnected
    expect(walletClient.client?.session.values.length).to.eql(0);
    expect(provider.connected).to.be.false;
  });

  it("networkChanged", async () => {
    // change to testnet
    await verifyNetworkChange(1, "https://testnet-wallet.alephium.org", provider, walletClient)

    // change back to devnet
    await verifyNetworkChange(NETWORK_ID, RPC_URL, provider, walletClient)

    // change to mainnet, which is not supported
    await expectThrowsAsync(
      async () => await walletClient.changeChain(0, "https://mainet-wallet.alephium.org"),
      "Error changing network id 0, chain alephium:0/0 not permitted"
    )
  });

  it("accountsChanged", async () => {
    // change to account c
    await verifyAccountsChange(ACCOUNTS.c.privateKey, ACCOUNTS.c.address, provider, walletClient)

    // change back to account a
    await verifyAccountsChange(ACCOUNTS.a.privateKey, ACCOUNTS.a.address, provider, walletClient)

    // change to account b, which is not supported
    await expectThrowsAsync(
      async () => await walletClient.changeAccount(ACCOUNTS.b.privateKey),
      "Error changing account, chain alephium:4/1 not permitted"
    )
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
    await Project.build()
    const accounts = await provider.getAccounts();

    expect(!!accounts).to.be.true;
    expect(accounts[0].address).to.eql(ACCOUNTS.a.address);

    balance = await nodeProvider.addresses.getAddressesAddressBalance(ACCOUNTS.a.address);
    expect(balance.utxoNum).to.eql(1);
    expect(walletClient.submitTx).to.be.true;

    await provider.signTransferTx({
      signerAddress: signerA.address,
      destinations: [{ address: ACCOUNTS.b.address, attoAlphAmount: ONE_ALPH }],
    });

    await checkBalanceDecreasing();
    const greeter = Project.contract("Greeter");

    const greeterParams = await greeter.paramsForDeployment({
      signerAddress: signerA.address,
      initialFields: { btcPrice: 1 },
    });
    const greeterResult = await signerA.signDeployContractTx(greeterParams);
    await checkBalanceDecreasing();

    const main = Project.script("Main");
    const mainParams = await main.paramsForDeployment({
      signerAddress: signerA.address,
      initialFields: { greeterContractId: greeterResult.contractId },
    });
    await signerA.signExecuteScriptTx(mainParams);
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
    const signClient = await SignClient.init(TEST_SIGN_CLIENT_OPTIONS);
    const { permittedChains, ...providerOpts } = TEST_PROVIDER_OPTS;
    provider = new WalletConnectProvider({
      permittedChains: [
        {
          networkId: NETWORK_ID,
          chainGroup: -1
        },
        {
          networkId: 1,
          chainGroup: -1
        }
      ],
      client: signClient,
      ...providerOpts
    });
    walletClient = await WalletClient.init(provider, TEST_WALLET_CLIENT_OPTS);
    walletAddress = walletClient.signer.address;
    expect(walletAddress).to.eql(ACCOUNTS.a.address);
    const providerAccounts = await provider.connect();
    expect(provider.chains).to.eql([
      "alephium:1/-1",
      "alephium:4/-1"
    ])
    expect(providerAccounts.map(a => a.address)).to.eql([
      signerA.address,
      signerB.address,
      signerC.address,
      signerD.address
    ]);
  });

  after(async () => {
    // disconnect provider
    await Promise.all([
      new Promise<void>(async resolve => {
        provider.on("disconnect", () => {
          resolve();
        });
      }),
      walletClient.disconnect()
    ]);
    // expect provider to be disconnected
    expect(walletClient.client?.session.values.length).to.eql(0);
    expect(provider.connected).to.be.false;
  });

  it("networkChanged", async () => {
    // change to testnet
    verifyNetworkChange(1, "https://testnet-wallet.alephium.org", provider, walletClient)

    // change back to devnet
    verifyNetworkChange(NETWORK_ID, RPC_URL, provider, walletClient)

    // change to mainnet, which is not supported
    await expectThrowsAsync(
      async () => await walletClient.changeChain(0, "https://mainet-wallet.alephium.org"),
      "Error changing network id 0, chain alephium:0/0 not permitted"
    )
  });

  it("accountsChanged", async () => {
    // change to account c
    await verifyAccountsChange(ACCOUNTS.c.privateKey, ACCOUNTS.c.address, provider, walletClient)

    // change back to account a
    await verifyAccountsChange(ACCOUNTS.a.privateKey, ACCOUNTS.a.address, provider, walletClient)
  });
});

async function verifyNetworkChange(
  networkId: number,
  rpcUrl: string,
  provider: WalletConnectProvider,
  walletClient: WalletClient
) {
  await Promise.all([
    new Promise<void>((resolve, reject) => {
      provider.on("networkChanged", networkId => {
        try {
          expect(networkId).to.eql(networkId);
          expect(provider.networkId).to.eql(networkId);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    }),
    walletClient.changeChain(networkId, rpcUrl)
  ]);
}

async function verifyAccountsChange(
  privateKey: string,
  address: string,
  provider: WalletConnectProvider,
  walletClient: WalletClient
) {
  await Promise.all([
    new Promise<void>((resolve, reject) => {
      provider.on("accountsChanged", accounts => {
        try {
          expect(accounts[0].address).to.eql(address);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    }),
    walletClient.changeAccount(privateKey)
  ]);
}

async function expectThrowsAsync(
  method: () => Promise<any>,
  errorMessage: string
) {
  let error: Error | undefined = undefined
  try {
    await method()
  } catch (err) {
    error = err
  }
  expect(error).to.be.an('Error')
  expect(error?.message).to.equal(errorMessage)
}