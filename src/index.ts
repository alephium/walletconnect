import { EventEmitter } from "eventemitter3";
import SignClient, { SIGN_CLIENT_EVENTS } from "@walletconnect/sign-client";
import { ISignClient, SignClientTypes } from "@walletconnect/types";
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
} from "@alephium/web3";

// Only available in TypeScript 4.5+
// Thank you Gerrit0: https://stackoverflow.com/a/49889856
type Awaited<T> = T extends PromiseLike<infer U>
  ? { 0: Awaited<U>; 1: U }[U extends PromiseLike<any> ? 0 : 1]
  : T

export const SIGNER_METHODS = [
  "alph_getAccounts",

  // Can also submit the signed transaction via the connected wallet.
  "alph_signTransferTx",
  "alph_signContractCreationTx",
  "alph_signScriptTx",

  // Can be used for complicated transactions (e.g. multisig).
  "alph_signUnsignedTx",
  "alph_signHexString",
  "alph_signMessage",
];

type SignerMethods = (typeof SIGNER_METHODS)[number];

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

export const SIGNER_EVENTS = [
  "accountsChanged",
  "networkChanged",
]

type SignerEvents = (typeof SIGNER_METHODS)[number];

export type SessionMetadata = Awaited<ReturnType<ISignClient["approve"]>>;

export interface WalletConnectProviderOptions {
  networkId: number;
  chainGroup: number;
  client: SignClient;
}

class WalletConnectProvider implements SignerProvider {
  public static namespace = "alephium";
  public networkId: number;
  public chainGroup?: number;
  public meta?: SessionMetadata;
  public session: SignClient;

  private methods = SIGNER_METHODS;

  get permittedChain(): string {
    return formatChain(this.networkId, this.chainGroup);
  }

  constructor(opts: WalletConnectProviderOptions) {
    this.networkId = opts.networkId;
    this.chainGroup = opts.chainGroup;
    this.session = opts.client;
    this.meta = undefined;
  }

  // ---------- Methods ----------------------------------------------- //

  public setSessionMetadata(meta: SessionMetadata) {
    this.meta = meta;
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

  private typedRequest<T extends SignerMethods>(
    method: T,
    params: MethodParams<T>,
  ): Promise<MethodResult<T>> {
    if (!this.meta) {
      return Promise.reject("Session has not be initialized yet. Must call provider.session.connect(...) first.");
    }

    if (this.methods.includes(method)) {
      return this.session.request({
        topic: this.meta.topic,
        chainId: this.permittedChain,
        request: {
          method,
          params,
        },
      });
    }
    return Promise.reject(`Invalid method was passed ${method}`);
  }
}

export function isCompatibleChain(chain: string): boolean {
  return chain.startsWith(`${WalletConnectProvider.namespace}:`);
}

export function formatChain(networkId: number, chainGroup?: number): string {
  const chainGroupEncoded = chainGroup !== undefined ? chainGroup : -1;
  return `${WalletConnectProvider.namespace}:${networkId}/${chainGroupEncoded}`;
}

export function isCompatibleChainGroup(chainGroup: number, expectedChainGroup?: number): boolean {
  return expectedChainGroup === undefined || expectedChainGroup === chainGroup;
}

export function parseChain(chainString: string): [number, number | undefined] {
  const [namespace, networkId, chainGroup] = chainString.replace(/\//g, ":").split(":");
  const chainGroupDecoded = parseInt(chainGroup, 10);
  return [parseInt(networkId, 10), chainGroupDecoded === -1 ? undefined : chainGroupDecoded];
}

export function formatAccount(permittedChain: string, account: Account): string {
  return `${permittedChain}:${account.address}+${account.publicKey}`;
}

export function parseAccount(account: string): Account {
  const [namespace, permittedChain, address, publicKey] = account.replace(/\+/g, ":").split(":");
  return {
    address: address,
    publicKey: publicKey,
    group: groupOfAddress(address),
  };
}

export function sameChains(chains0: string[], chains1?: string[]): boolean {
  if (typeof chains1 === "undefined") {
    return false;
  } else {
    return chains0.join() === chains1.join();
  }
}

export function sameAccounts(account0: Account[], account1?: Account[]): boolean {
  if (typeof account1 === "undefined") {
    return false;
  } else {
    return account0.map(a => a.address).join() === account1.map(a => a.address).join();
  }
}

export default WalletConnectProvider;
