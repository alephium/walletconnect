import EventEmitter from "eventemitter3";
import { SessionTypes, SignClientTypes } from "@walletconnect/types";
import {
  SignerProvider,
  Account,
  SignTransferTxParams,
  SignTransferTxResult,
  SignDeployContractTxParams,
  SignDeployContractTxResult,
  SignExecuteScriptTxParams,
  SignExecuteScriptTxResult,
  SignUnsignedTxParams,
  SignUnsignedTxResult,
  SignMessageParams,
  SignMessageResult,
  groupOfAddress,
  addressFromPublicKey,
  NodeProvider,
  ExplorerProvider,
  ApiRequestArguments
} from "@alephium/web3";

import { getChainsFromNamespaces, getAccountsFromNamespaces, getSdkError } from "@walletconnect/utils";
import SignClient from "@walletconnect/sign-client";
import { LOGGER, PROVIDER_NAMESPACE, RELAY_METHODS, RELAY_URL } from "./constants";
import { ChainGroup, MethodParams, MethodResult, NetworkId, ProviderEvent, ProviderMethod } from "./types";

export interface ProviderOptions {
  // Alephium options
  networkId: number;
  chainGroup: ChainGroup;
  methods?: ProviderMethod[];

  // WalletConnect options
  projectId?: string;
  metadata?: SignClientTypes.Metadata;
  logger?: string;
  client?: SignClient;
  relayUrl?: string;
}

class WalletConnectProvider implements SignerProvider {
  private providerOpts: ProviderOptions;

  public events: EventEmitter = new EventEmitter();
  public nodeProvider: NodeProvider | undefined;
  public explorerProvider: ExplorerProvider | undefined;

  public networkId: number;
  public chainGroup: ChainGroup;
  public permittedChain: string;
  public methods: ProviderMethod[];

  public account: Account | undefined = undefined;

  public client!: SignClient;
  public session!: SessionTypes.Struct;

  static async init(opts: ProviderOptions): Promise<WalletConnectProvider> {
    const provider = new WalletConnectProvider(opts);
    await provider.initialize();
    return provider;
  }

  constructor(opts: ProviderOptions) {
    this.providerOpts = opts;
    this.networkId = opts.networkId;
    this.chainGroup = opts.chainGroup;
    this.permittedChain = formatChain(this.networkId, this.chainGroup);

    this.methods = opts.methods ?? RELAY_METHODS;
    if (this.methods.includes("alph_requestNodeApi")) {
      this.nodeProvider = NodeProvider.Remote(this.requestNodeAPI);
    } else {
      this.nodeProvider = undefined;
    }
    if (this.methods.includes("alph_requestNodeApi")) {
      this.explorerProvider = ExplorerProvider.Remote(this.requestExplorerAPI);
    } else {
      this.explorerProvider = undefined;
    }
  }

  // The provider only supports signer methods. The other requests should use Alephium Rest API.
  public async request<T = unknown>(args: { method: string, params: any }): Promise<T> {
    if (args.method === "alph_getSelectedAccount") {
      return Promise.resolve(this.account as T);
    }

    if (!(this.methods as string[]).includes(args.method)) {
      return Promise.reject(new Error(`Invalid method was passed ${args.method}`));
    }

    if (!args.method.startsWith("alph_request")) {
      const signerAddress = args.params?.signerAddress;
      if (typeof signerAddress === "undefined") {
        throw new Error("Cannot request without signerAddress");
      }
      const selectedAccount = await this.getSelectedAccount();
      if (signerAddress !== selectedAccount.address) {
        throw new Error(`Invalid signer address ${args.params.signerAddress}`);
      }
    }

    return this.client.request({
      request: {
        method: args.method,
        params: args.params
      },
      chainId: this.permittedChain,
      topic: this.session?.topic,
    });
  }

  public async connect(): Promise<void> {
    const { uri, approval } = await this.client.connect({
      requiredNamespaces: {
        alephium: {
          chains: [this.permittedChain],
          methods: this.methods,
          events: ["accountChanged"],
        },
      },
    });

    if (uri) {
      this.emitEvents("displayUri", uri);
    }

    this.session = await approval();
    this.updateNamespace(this.session.namespaces);
  }

  public async disconnect(): Promise<void> {
    if (!this.client) {
      throw new Error("Sign Client not initialized");
    }

    await this.client.disconnect({
      topic: this.session.topic,
      reason: getSdkError("USER_DISCONNECTED")
    });
  }

  public on(event: ProviderEvent, listener: any): void {
    this.events.on(event, listener);
  }

  public once(event: ProviderEvent, listener: any): void {
    this.events.once(event, listener);
  }

  public removeListener(event: ProviderEvent, listener: any): void {
    this.events.removeListener(event, listener);
  }

  public off(event: ProviderEvent, listener: any): void {
    this.events.off(event, listener);
  }

  // ---------- Methods ----------------------------------------------- //

  public getSelectedAccount(): Promise<Account> {
    return this.typedRequest("alph_getSelectedAccount", undefined);
  }

  public async signAndSubmitTransferTx(params: SignTransferTxParams): Promise<SignTransferTxResult> {
    return this.typedRequest("alph_signAndSubmitTransferTx", params);
  }

  public async signAndSubmitDeployContractTx(
    params: SignDeployContractTxParams,
  ): Promise<SignDeployContractTxResult> {
    return this.typedRequest("alph_signAndSubmitDeployContractTx", params);
  }

  public async signAndSubmitExecuteScriptTx(
    params: SignExecuteScriptTxParams,
  ): Promise<SignExecuteScriptTxResult> {
    return this.typedRequest("alph_signAndSubmitExecuteScriptTx", params);
  }

  public async signAndSubmitUnsignedTx(params: SignUnsignedTxParams): Promise<SignUnsignedTxResult> {
    return this.typedRequest("alph_signAndSubmitUnsignedTx", params);
  }

  public async signUnsignedTx(params: SignUnsignedTxParams): Promise<SignUnsignedTxResult> {
    return this.typedRequest("alph_signUnsignedTx", params);
  }

  public async signMessage(params: SignMessageParams): Promise<SignMessageResult> {
    return this.typedRequest("alph_signMessage", params);
  }

  // ---------- Private ----------------------------------------------- //

  private async initialize() {
    await this.createClient();
    this.checkStorage();
    this.registerEventListeners();
  }

  private async createClient() {
    this.client =
      this.providerOpts.client ||
      (await SignClient.init({
        logger: this.providerOpts.logger || LOGGER,
        relayUrl: this.providerOpts.relayUrl || RELAY_URL,
        projectId: this.providerOpts.projectId,
        metadata: this.providerOpts.metadata, // fetch metadata automatically if not provided?
      }));
  }

  private async checkStorage() {
    if (this.client.session.length) {
      const lastKeyIndex = this.client.session.keys.length - 1;
      this.session = this.client.session.get(this.client.session.keys[lastKeyIndex]);
    }
  }

  private registerEventListeners() {
    if (typeof this.client === "undefined") {
      throw new Error("Sign Client is not initialized");
    }

    this.client.on("session_ping", (args) => {
      this.emitEvents("session_ping", args);
    });

    this.client.on("session_event", (args) => {
      this.emitEvents("session_event", args);
    });

    this.client.on("session_update", ({ topic, params }) => {
      const { namespaces } = params;
      const _session = this.client?.session.get(topic);
      this.session = { ..._session, namespaces } as SessionTypes.Struct;
      this.updateNamespace(this.session.namespaces);
      this.emitEvents("session_update", { topic, params });
    });

    this.client.on("session_delete", () => {
      this.emitEvents("session_delete");
    });
  }

  private emitEvents(event: ProviderEvent, data?: any): void {
    this.events.emit(event, data);
  }

  private typedRequest<T extends ProviderMethod>(
    method: T,
    params: MethodParams<T>
  ): Promise<MethodResult<T>> {
    return this.request({ method, params });
  }

  private requestNodeAPI = (args: ApiRequestArguments): Promise<any> => {
    return this.typedRequest("alph_requestNodeApi", args);
  }

  private requestExplorerAPI = (args: ApiRequestArguments): Promise<any> => {
    return this.typedRequest("alph_requestExplorerApi", args);
  }

  private updateNamespace(namespaces: SessionTypes.Namespaces) {
    const chains = getChainsFromNamespaces(namespaces, [PROVIDER_NAMESPACE]);
    this.setChain(chains);
    const accounts = getAccountsFromNamespaces(namespaces, [PROVIDER_NAMESPACE]);
    this.setAccounts(accounts);
  }

  private sameChains(chains0: string[], chains1?: string[]): boolean {
    if (typeof chains1 === "undefined") {
      return false;
    } else {
      return chains0.join() === chains1.join();
    }
  }

  private setChain(chains: string[]) {
    if (!this.sameChains(chains, [this.permittedChain])) {
      throw Error("Network or chain group has changed");
    }
  }

  private sameAccounts(account0: Account[], account1?: Account[]): boolean {
    if (typeof account1 === "undefined") {
      return false;
    } else {
      return account0.map(a => a.address).join() === account1.map(a => a.address).join();
    }
  }

  private lastSetAccounts?: Account[];
  private setAccounts(accounts: string[]) {
    const parsedAccounts = accounts.map(parseAccount);
    if (this.sameAccounts(parsedAccounts, this.lastSetAccounts)) {
      return;
    } else {
      this.lastSetAccounts = parsedAccounts;
    }

    if (parsedAccounts.length !== 1) {
      throw Error(`The WC provider does not supports multiple accounts`);
    }

    const newAccount = parsedAccounts[0];
    if (!isCompatibleChainGroup(newAccount.group, this.chainGroup)) {
      throw Error(`The new account belongs to an unexpected chain group`);
    }

    this.account = newAccount;
    this.emitEvents("accountChanged", newAccount);
  }
}

export function isCompatibleChain(chain: string): boolean {
  return chain.startsWith(`${PROVIDER_NAMESPACE}:`);
}

export function isCompatibleChainGroup(group: ChainGroup, expectedChainGroup?: ChainGroup): boolean {
  return expectedChainGroup === undefined || expectedChainGroup === group;
}

export function formatChain(networkId: number, chainGroup: ChainGroup): string {
  if (chainGroup !== undefined && chainGroup < 0) {
    throw Error("Chain group in provider needs to be either undefined or non-negative");
  }
  const chainGroupEncoded = chainGroup !== undefined ? chainGroup : -1;
  return `${PROVIDER_NAMESPACE}:${networkId}/${chainGroupEncoded}`;
}

export function parseChain(chainString: string): [NetworkId, ChainGroup] {
  const [_namespace, networkId, chainGroup] = chainString.replace(/\//g, ":").split(":");
  const chainGroupDecoded = parseInt(chainGroup, 10);
  if (chainGroupDecoded < -1) {
    throw Error("Chain group in protocol needs to be either -1 or non-negative");
  }
  return [parseInt(networkId, 10), chainGroupDecoded === -1 ? undefined : chainGroupDecoded];
}

export function formatAccount(permittedChain: string, account: Account): string {
  return `${permittedChain}:${account.publicKey}`;
}

export function parseAccount(account: string): Account {
  const [_namespace, _networkId, _group, publicKey] = account.replace(/\//g, ":").split(":");
  const address = addressFromPublicKey(publicKey);
  const group = groupOfAddress(address);
  return { address, group, publicKey };
}

export * from "./constants";
export * from "./types";
export default WalletConnectProvider;
