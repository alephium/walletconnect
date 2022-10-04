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
  GetAccountsResult,
  SignTransferTxParams,
  SignTransferTxResult,
  SignDeployContractTxParams,
  SignDeployContractTxResult,
  SignExecuteScriptTxParams,
  SignExecuteScriptTxResult,
  SignUnsignedTxParams,
  SignUnsignedTxResult,
  SignHexStringParams,
  SignHexStringResult,
  SignMessageParams,
  SignMessageResult,
  groupOfAddress,
  addressFromPublicKey,
} from "@alephium/web3";

import { getChainsFromNamespaces, getAccountsFromNamespaces } from "@walletconnect/utils";

// Note:
// 1. the wallet client could potentially submit the signed transaction.
// 2. `alph_signUnsignedTx` can be used for complicated transactions (e.g. multisig).
export const signerMethods = [
  "alph_getAccounts",
  "alph_signTransferTx",
  "alph_signContractCreationTx",
  "alph_signScriptTx",
  "alph_signUnsignedTx",
  "alph_signHexString",
  "alph_signMessage",
];
type SignerMethodsTuple = typeof signerMethods;
type SignerMethods = SignerMethodsTuple[number];

export type NetworkId = number
export type ChainGroup = number

interface SignerMethodsTable extends Record<SignerMethods, { params: any; result: any }> {
  alph_getAccounts: {
    params: undefined;
    result: GetAccountsResult;
  };
  alph_signTransferTx: {
    params: SignTransferTxParams;
    result: SignTransferTxResult;
  };
  alph_signContractCreationTx: {
    params: SignDeployContractTxParams;
    result: SignDeployContractTxResult;
  };
  alph_signScriptTx: {
    params: SignExecuteScriptTxParams;
    result: SignExecuteScriptTxResult;
  };
  alph_signUnsignedTx: {
    params: SignUnsignedTxParams;
    result: SignUnsignedTxResult;
  };
  alph_signHexString: {
    params: SignHexStringParams;
    result: SignHexStringResult;
  };
  alph_signMessage: {
    params: SignMessageParams;
    result: SignMessageResult;
  };
}
export type MethodParams<T extends SignerMethods> = SignerMethodsTable[T]["params"];
export type MethodResult<T extends SignerMethods> = SignerMethodsTable[T]["result"];

export const PROVIDER_EVENTS = {
  connect: "connect",
  disconnect: "disconnect",
  displayUri: "displayUri",
  networkChanged: "networkChanged",
  accountsChanged: "accountsChanged",
};

export interface ChainInfo {
  networkId: NetworkId;
  chainGroup: ChainGroup;
}

export type PermittedChainGroups = Record<NetworkId, ChainGroup[]>

export const ALEPHIUM_NAMESPACE = "alephium";

export interface WalletConnectProviderOptions {
  permittedChains: ChainInfo[];
  methods?: string[];
  client?: SignerConnectionClientOpts;
}

class WalletConnectProvider implements SignerProvider {
  public events: any = new EventEmitter();
  public networkId: number;
  public permittedChainGroups: PermittedChainGroups;
  public methods = signerMethods;

  // Wallet may return accounts from chains not defined in the proposal
  public chains: string[] = [];
  public accounts: Account[] = [];

  public signer: JsonRpcProvider;

  get permittedChains(): string[] {
    return Object.entries(this.permittedChainGroups).flatMap(([networkId, chainGroups]) => {
      return chainGroups.map((chainGroup) => formatChain(+networkId, chainGroup));
    });
  }

  constructor(opts: WalletConnectProviderOptions) {
    if (opts.permittedChains.length === 0) {
      throw new Error(`No permittedChains`);
    }

    this.networkId = opts.permittedChains[0].networkId;
    this.permittedChainGroups = getPermittedChainGroups(opts.permittedChains);
    this.methods = opts.methods ? [...opts.methods, ...this.methods] : this.methods;
    this.signer = this.setSignerProvider(opts.client);
    this.registerEventListeners();
  }

  // The provider only supports signer methods. The other requests should use Alephium Rest API.
  public async request<T = unknown>(args: RequestArguments): Promise<T> {
    if (args.method === "alph_getAccounts") {
      return this.accounts as any;
    }
    if (this.methods.includes(args.method)) {
      const signerAddress = args.params?.signerAddress;
      if (typeof signerAddress === "undefined") {
        throw new Error("Cannot request without signerAddress");
      }
      const signerAccount = this.accounts.find(
        account => account.address === args.params.signerAddress,
      );
      if (typeof signerAccount === "undefined") {
        throw new Error(`Unknown signer address ${args.params.signerAddress}`);
      }
      return this.signer.request(args, {
        chainId: formatChain(this.networkId, signerAccount.group),
      });
    }
    return Promise.reject(new Error(`Invalid method was passed ${args.method}`));
  }

  public async connect(): Promise<GetAccountsResult> {
    await this.signer.connect();
    return this.accounts;
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
    params: MethodParams<T>,
  ): Promise<MethodResult<T>> {
    return this.request({ method, params });
  }

  public getAccounts(): Promise<Account[]> {
    return this.typedRequest("alph_getAccounts", undefined);
  }

  public async signTransferTx(params: SignTransferTxParams): Promise<SignTransferTxResult> {
    return this.typedRequest("alph_signTransferTx", params);
  }

  public async signDeployContractTx(
    params: SignDeployContractTxParams,
  ): Promise<SignDeployContractTxResult> {
    return this.typedRequest("alph_signContractCreationTx", params);
  }

  public async signExecuteScriptTx(
    params: SignExecuteScriptTxParams,
  ): Promise<SignExecuteScriptTxResult> {
    return this.typedRequest("alph_signScriptTx", params);
  }

  public async signUnsignedTx(params: SignUnsignedTxParams): Promise<SignUnsignedTxResult> {
    return this.typedRequest("alph_signUnsignedTx", params);
  }

  public async signHexString(params: SignHexStringParams): Promise<SignHexStringResult> {
    return this.typedRequest("alph_signHexString", params);
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
        if (event.name === PROVIDER_EVENTS.accountsChanged) {
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
          chains: this.permittedChains,
          methods: this.methods,
          events: ["chainChanged", "accountsChanged", "networkChanged"],
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
    if (!this.sameChains(chains, this.chains)) {
      const chainInfos = chains.map((chain) => {
        const [networkId, chainGroup] = parseChain(chain);
        return { networkId, chainGroup };
      });

      this.permittedChainGroups = getPermittedChainGroups(chainInfos);
      this.chains = chains;
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

    const permittedGroups = this.permittedChainGroups[this.networkId];
    const newAccounts = parsedAccounts
      .filter(account =>
        permittedGroups.includes(-1) || permittedGroups.includes(account.group),
      )
      .filter((value, index, array) =>
        array.findIndex(v => (v.address === value.address)) === index,
      );
    if (newAccounts.length !== 0 && !this.sameAccounts(newAccounts, this.accounts)) {
      this.accounts = newAccounts;
      this.events.emit(PROVIDER_EVENTS.accountsChanged, newAccounts);
    }
  }
}

export function isCompatibleChain(chain: string): boolean {
  return chain.startsWith(`${ALEPHIUM_NAMESPACE}:`);
}

export function formatChain(networkId: number, chainGroup: number): string {
  return `${ALEPHIUM_NAMESPACE}:${networkId}/${chainGroup}`;
}

export function parseChain(chainString: string): [number, number] {
  const [_namespace, networkId, chainGroup] = chainString.replace(/\//g, ":").split(":");
  const chainGroupDecoded = parseInt(chainGroup, 10);
  return [parseInt(networkId, 10), chainGroupDecoded];
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

export function getPermittedChainGroups(infos: ChainInfo[]): PermittedChainGroups {
  return infos.reduce((acc, info) => {
    const networkId = info.networkId;
    const chainGroup = info.chainGroup;
    acc[networkId] = acc[networkId] || [];

    if (acc[networkId].includes(-1)) {
      return acc;
    }

    if (chainGroup === -1) {
      acc[networkId] = [-1];
    } else if (!acc[networkId].includes(chainGroup)) {
      acc[networkId].push(chainGroup);
    }
    return acc;
  }, Object.create({}));
}

export function getPermittedChainId(
  networkId: NetworkId,
  chainGroup: ChainGroup,
  permittedChainGroups?: PermittedChainGroups,
): string | undefined {
  const chainGroups = permittedChainGroups?.[networkId];
  if (chainGroups === undefined) {
    return undefined;
  }

  if (chainGroups.includes(-1)) {
    return formatChain(networkId, -1);
  }

  if (chainGroups.includes(chainGroup)) {
    return formatChain(networkId, chainGroup);
  }

  return undefined;
}

export default WalletConnectProvider;
