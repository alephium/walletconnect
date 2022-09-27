import { SessionTypes, SignClientTypes } from "@walletconnect/types";
import { formatJsonRpcError, formatJsonRpcResult } from "@walletconnect/jsonrpc-utils";
import {
  NodeProvider,
  SignTransferTxParams,
  SignDeployContractTxParams,
  SignExecuteScriptTxParams,
  SignUnsignedTxParams,
  SignHexStringParams,
  SignMessageParams,
  Account,
} from "@alephium/web3";
import { PrivateKeyWallet } from "@alephium/web3-wallet";

import WalletConnectProvider, {
  parseChain,
  formatChain,
  formatAccount,
  providerEvents,
} from "../../src";
import SignClient from "@walletconnect/sign-client";

export interface WalletClientOpts {
  privateKey: string;
  networkId: number;
  rpcUrl: string;
  submitTx?: boolean;
}

export type WalletClientAsyncOpts = WalletClientOpts & SignClientTypes.Options;

export class WalletClient {
  public provider: WalletConnectProvider;
  public nodeProvider: NodeProvider;
  public signer: PrivateKeyWallet;
  public networkId: number;
  public rpcUrl: string;
  public submitTx: boolean;

  public client?: SignClient;
  public topic?: string;

  public namespaces?: SessionTypes.Namespaces;

  public permittedNetworkId?: number;
  public permittedChainGroup?: number;

  get permittedChain(): string {
    if (typeof this.permittedNetworkId === "undefined") {
      throw new Error("Permitted chain is not set");
    }
    return formatChain(this.permittedNetworkId, this.permittedChainGroup);
  }

  get currentChain(): string {
    return formatChain(this.networkId, this.permittedChainGroup);
  }

  static async init(
    provider: WalletConnectProvider,
    opts: Partial<WalletClientAsyncOpts>,
  ): Promise<WalletClient> {
    const walletClient = new WalletClient(provider, opts);
    await walletClient.initialize(opts);
    return walletClient;
  }

  get group(): number {
    return this.signer.group;
  }

  get account(): Account {
    return {
      address: this.signer.address,
      publicKey: this.signer.publicKey,
      group: this.signer.group,
    };
  }

  get accounts(): Account[] {
    return [this.account];
  }

  constructor(provider: WalletConnectProvider, opts: Partial<WalletClientOpts>) {
    this.provider = provider;
    this.networkId = opts?.networkId || 4;
    this.rpcUrl = opts?.rpcUrl || "http://alephium:22973";
    this.submitTx = opts?.submitTx || false;
    this.nodeProvider = new NodeProvider(this.rpcUrl);
    this.signer = this.getWallet(opts.privateKey);
  }

  public async changeAccount(privateKey: string) {
    this.setAccount(privateKey);
    await this.updateAccounts();
  }

  public async changeChain(networkId: number, rpcUrl: string) {
    this.setNetworkId(networkId, rpcUrl);
    await this.updateChainId();
  }

  public async disconnect() {
    if (!this.client) return;
    if (!this.topic) return;

    await this.client.disconnect({
      topic: this.topic,
      reason: {
        code: 0,
        message: "disconnect"
      }
    });
  }

  private setAccount(privateKey: string) {
    this.signer = this.getWallet(privateKey);
  }

  private setNetworkId(networkId: number, rpcUrl: string) {
    if (this.networkId !== networkId) {
      this.networkId = networkId;
    }
    if (this.rpcUrl !== rpcUrl) {
      this.rpcUrl = rpcUrl;
    }
  }

  private async emitAccountsChangedEvent() {
    if (typeof this.client === "undefined") return;
    if (typeof this.topic === "undefined") return;
    const event = {
      name: providerEvents.changed.accounts,
      data: [
        formatAccount(`alephium:${this.networkId}/0`, this.account)
      ],
    };
    await this.client.emit({
      topic: this.topic,
      event,
      chainId: `alephium:${this.networkId}/0`
    });
  }

  private async emitChainChangedEvent() {
    if (typeof this.client === "undefined") return;
    if (typeof this.topic === "undefined") return;
    const event = {
      name: providerEvents.changed.network,
      data: this.networkId
    }
    // TODO: Figure out how to do groups
    await this.client.emit({ topic: this.topic, event, chainId: this.currentChain });
  }

  private getWallet(privateKey?: string): PrivateKeyWallet {
    const wallet =
      typeof privateKey !== "undefined"
        ? new PrivateKeyWallet(privateKey)
        : PrivateKeyWallet.Random();
    return wallet;
  }

  private async updateSession() {
    if (typeof this.client === "undefined") return;
    if (typeof this.topic === "undefined") return;
    if (typeof this.namespaces === "undefined") return;
    if (typeof this.permittedNetworkId === "undefined") return;
    await this.client.update({ topic: this.topic, namespaces: this.namespaces });
  }

  private async updateAccounts() {
    await this.updateSession();
    await this.emitAccountsChangedEvent();
  }

  private async updateChainId() {
    await this.updateSession();
    await this.emitChainChangedEvent();
  }

  private async initialize(opts?: SignClientTypes.Options) {
    this.client = await SignClient.init(opts);
    this.registerEventListeners();
  }

  private registerEventListeners() {
    if (typeof this.client === "undefined") {
      throw new Error("Client not initialized");
    }

    // auto-pair
    this.provider.on("display_uri", async (uri: string) => {
      if (typeof this.client === "undefined") {
        throw new Error("Client not initialized");
      }
      await this.client.pair({ uri });
    });

    // auto-approve
    this.client.on(
      "session_proposal",
      async (proposal: SignClientTypes.EventArguments["session_proposal"]) => {
        if (typeof this.client === "undefined") throw new Error("Sign Client not inititialized");
        const { id, requiredNamespaces, relays } = proposal.params;

        const namespaces = {};
        Object.entries(requiredNamespaces).forEach(([key, value]) => {
          namespaces[key] = {
            methods: value.methods,
            events: value.events,
            accounts: value.chains.map((chain) => `${chain}:${this.accounts[0].address}`),
            extension: value.extension?.map((ext) => ({
              methods: ext.methods,
              events: ext.events,
              accounts: ext.chains.map((chain) => `${chain}:${this.accounts[0].address}`),
            })),
          };
        });

        const permittedChain = requiredNamespaces["alephium"].chains[0]

        if (typeof permittedChain === "undefined") {
          throw new Error("No chain is permitted");
        }

        [this.permittedNetworkId, this.permittedChainGroup] = parseChain(permittedChain);

        const { acknowledged } = await this.client.approve({
          id,
          relayProtocol: relays[0].protocol,
          namespaces,
        });
        const session = await acknowledged();
        this.topic = session.topic;
        this.namespaces = namespaces;
      },
    );

    // auto-respond
    this.client.on(
      "session_request",
      async (requestEvent: SignClientTypes.EventArguments["session_request"]) => {
        if (typeof this.client === "undefined") {
          throw new Error("Client not initialized");
        }

        const { topic, params, id } = requestEvent;
        const { chainId, request } = params;

        // ignore if unmatched topic
        if (topic !== this.topic) return;

        try {
          // reject if no present target chain
          if (typeof chainId === "undefined") {
            throw new Error("Missing target chain");
          }

          // reject if unmatched chain
          if (this.currentChain != chainId) {
            throw new Error(
              `Target chain (${chainId}) does not match current chain (${this.currentChain})`,
            );
          }

          let result: any;

          switch (request.method) {
            case "alph_signTransferTx":
              result = await this.signer.signTransferTx(
                (request.params as any) as SignTransferTxParams,
              );
              break;
            case "alph_signContractCreationTx":
              result = await this.signer.signDeployContractTx(
                (request.params as any) as SignDeployContractTxParams,
              );
              break;
            case "alph_signScriptTx":
              result = await this.signer.signExecuteScriptTx(
                (request.params as any) as SignExecuteScriptTxParams,
              );
              break;
            case "alph_signUnsignedTx":
              result = await this.signer.signUnsignedTx(
                (request.params as any) as SignUnsignedTxParams,
              );
              break;
            case "alph_signHexString":
              result = await this.signer.signHexString(
                (request.params as any) as SignHexStringParams,
              );
              break;
            case "alph_signMessage":
              result = await this.signer.signMessage((request.params as any) as SignMessageParams);
              break;
            default:
              throw new Error(`Method not supported: ${request.method}`);
          }

          // reject if undefined result
          if (typeof result === "undefined") {
            throw new Error("Result was undefined");
          }

          const response = formatJsonRpcResult(id, result);
          await this.client.respond({ topic, response });
        } catch (e) {
          const message = e.message || e.toString();
          const response = formatJsonRpcError(id, message);
          await this.client.respond({ topic, response });
        }
      },
    );
  }
}
