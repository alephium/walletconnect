import { EventEmitter } from "eventemitter3";
import { JsonRpcProvider } from "@walletconnect/jsonrpc-provider";
import { RequestArguments } from "@walletconnect/jsonrpc-utils";
import { SessionTypes } from "@walletconnect/types";
import {
  SignerConnection,
  SIGNER_EVENTS,
  SignerConnectionClientOpts,
} from "@walletconnect/signer-connection";
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

import { getChainsFromNamespaces, getAccountsFromNamespaces } from "@walletconnect/utils";

// Note:
// 1. the wallet client could potentially submit the signed transaction.
// 2. `alph_signUnsignedTx` can be used for complicated transactions (e.g. multisig).
export const signerMethods = [
  "alph_getSelectedAccount",
  "alph_signAndSubmitTransferTx",
  "alph_signAndSubmitDeployContractTx",
  "alph_signAndSubmitExecuteScriptTx",
  "alph_signAndSubmitUnsignedTx",
  "alph_signUnsignedTx",
  "alph_signMessage",
  "alph_requestNodeApi",
  "alph_requestExplorerApi"
] as const;
type SignerMethodsTuple = typeof signerMethods;
export type SignerMethods = SignerMethodsTuple[number];

interface SignerMethodsTable extends Record<SignerMethods, { params: any; result: any }> {
  alph_getSelectedAccount: {
    params: undefined;
    result: Account;
  };
  alph_signAndSubmitTransferTx: {
    params: SignTransferTxParams;
    result: SignTransferTxResult
  };
  alph_signAndSubmitDeployContractTx: {
    params: SignDeployContractTxParams;
    result: SignDeployContractTxResult
  };
  alph_signAndSubmitExecuteScriptTx: {
    params: SignExecuteScriptTxParams;
    result: SignExecuteScriptTxResult
  };
  alph_signAndSubmitUnsignedTx: {
    params: SignUnsignedTxParams;
    result: SignUnsignedTxResult
  };
  alph_signUnsignedTx: {
    params: SignUnsignedTxParams;
    result: SignUnsignedTxResult;
  };
  alph_signMessage: {
    params: SignMessageParams;
    result: SignMessageResult;
  };
  alph_requestNodeApi: {
    params: ApiRequestArguments;
    result: any
  };
  alph_requestExplorerApi: {
    params: ApiRequestArguments;
    result: any
  }
}
type MethodParams<T extends SignerMethods> = SignerMethodsTable[T]["params"];
type MethodResult<T extends SignerMethods> = SignerMethodsTable[T]["result"];

export const PROVIDER_EVENTS = {
  connect: "connect",
  disconnect: "disconnect",
  displayUri: "displayUri",
  networkChanged: "networkChanged",
  accountChanged: "accountChanged",
};

export type NetworkId = number
export type ChainGroup = number | undefined
export interface ChainInfo {
  networkId: NetworkId;
  chainGroup: ChainGroup;
}

export const ALEPHIUM_NAMESPACE = "alephium";

export interface WalletConnectProviderOptions {
  networkId: number;
  chainGroup: ChainGroup;
  methods?: string[];
  client?: SignerConnectionClientOpts;
}

class WalletConnectProvider implements SignerProvider {
  public events: any = new EventEmitter();
  public nodeProvider: NodeProvider | undefined;
  public explorerProvider: ExplorerProvider | undefined;

  public networkId: number;
  public chainGroup: ChainGroup;
  public methods: string[];

  public account: Account | undefined = undefined;

  public signer: JsonRpcProvider;

  private get permittedChain(): string {
    return formatChain(this.networkId, this.chainGroup);
  }

  constructor(opts: WalletConnectProviderOptions) {
    this.networkId = opts.networkId;
    this.chainGroup = opts.chainGroup;

    this.methods = opts.methods ?? [...signerMethods];
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

    this.signer = this.setSignerProvider(opts.client);
    this.registerEventListeners();
  }

  // The provider only supports signer methods. The other requests should use Alephium Rest API.
  public async request<T = unknown>(args: RequestArguments): Promise<T> {
    if (args.method === "alph_getSelectedAccount") {
      return Promise.resolve(this.account as T);
    }

    if (!this.methods.includes(args.method)) {
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

    return this.signer.request(args, { chainId: this.permittedChain });
  }

  public async connect(): Promise<void> {
    await this.signer.connect();
  }

  get connected(): boolean {
    return (this.signer.connection as SignerConnection).connected;
  }

  get connecting(): boolean {
    return (this.signer.connection as SignerConnection).connecting;
  }

  public async disconnect(): Promise<void> {
    await this.signer.disconnect();
  }

  public on(event: any, listener: any): void {
    this.events.on(event, listener);
  }

  public once(event: string, listener: any): void {
    this.events.once(event, listener);
  }

  public removeListener(event: string, listener: any): void {
    this.events.removeListener(event, listener);
  }

  public off(event: string, listener: any): void {
    this.events.off(event, listener);
  }

  // ---------- Methods ----------------------------------------------- //

  private typedRequest<T extends SignerMethods>(
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
  private registerEventListeners() {
    this.signer.on("connect", async () => {
      const chains = (this.signer.connection as SignerConnection).chains;
      if (chains && chains.length) this.setChain(chains);
      const accounts = (this.signer.connection as SignerConnection).accounts;
      if (accounts && accounts.length) this.setAccounts(accounts);
      this.events.emit(PROVIDER_EVENTS.connect);
    });

    this.signer.on("disconnect", () => {
      this.events.emit(PROVIDER_EVENTS.disconnect);
    });

    this.signer.connection.on(SIGNER_EVENTS.created, (session: SessionTypes.Struct) => {
      this.updateNamespace(session);
    });

    this.signer.connection.on(SIGNER_EVENTS.uri, async ({ uri }: { uri: string }) => {
      this.events.emit(PROVIDER_EVENTS.displayUri, uri);
    });

    this.signer.connection.on(SIGNER_EVENTS.updated, (session: SessionTypes.Struct) => {
      this.updateNamespace(session);
    });

    this.signer.connection.on(
      SIGNER_EVENTS.event,
      (params: any) => {
        const { event } = params;
        if (event.name === PROVIDER_EVENTS.accountChanged) {
          this.setAccounts(event.data);
        } else if (event.name === PROVIDER_EVENTS.networkChanged) {
          this.networkId = event.data;
          this.events.emit(PROVIDER_EVENTS.networkChanged, this.networkId);
        } else {
          this.events.emit(event.name, event.data);
        }
      },
    );
  }

  private setSignerProvider(
    client?: SignerConnectionClientOpts,
  ) {
    const connection = new SignerConnection({
      client,
      requiredNamespaces: {
        alephium: {
          chains: [this.permittedChain],
          methods: this.methods,
          events: ["accountChanged"],
        },
      },
    });
    return new JsonRpcProvider(connection);
  }

  private updateNamespace(session: SessionTypes.Struct) {
    const chains = getChainsFromNamespaces(session.namespaces, [ALEPHIUM_NAMESPACE]);
    this.setChain(chains);
    const accounts = getAccountsFromNamespaces(session.namespaces, [ALEPHIUM_NAMESPACE]);
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
    this.events.emit(PROVIDER_EVENTS.accountChanged, newAccount);
  }
}

export function isCompatibleChain(chain: string): boolean {
  return chain.startsWith(`${ALEPHIUM_NAMESPACE}:`);
}

export function isCompatibleChainGroup(group: ChainGroup, expectedChainGroup?: ChainGroup): boolean {
  return expectedChainGroup === undefined || expectedChainGroup === group;
}

export function formatChain(networkId: number, chainGroup: ChainGroup): string {
  if (chainGroup !== undefined && chainGroup < 0) {
    throw Error("Chain group in provider needs to be either undefined or non-negative");
  }
  const chainGroupEncoded = chainGroup !== undefined ? chainGroup : -1;
  return `${ALEPHIUM_NAMESPACE}:${networkId}/${chainGroupEncoded}`;
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

export default WalletConnectProvider;
