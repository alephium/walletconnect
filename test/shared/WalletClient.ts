import Client, { CLIENT_EVENTS } from "@walletconnect/client";
import { ClientOptions, IClient, SessionTypes } from "@walletconnect/types";
import { ERROR } from "@walletconnect/utils";
import { SIGNER_EVENTS } from "@walletconnect/signer-connection";
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
import { PrivateKeyWallet } from "@alephium/web3/test";

import WalletConnectProvider, {
  isCompatibleChainGroup,
  parseChain,
  formatChain,
  formatAccount,
  providerEvents,
} from "../../src";

export interface WalletClientOpts {
  privateKey: string;
  networkId: number;
  rpcUrl: string;
  submitTx?: boolean;
}

export type WalletClientAsyncOpts = WalletClientOpts & ClientOptions;

export class WalletClient {
  public provider: WalletConnectProvider;
  public nodeProvider: NodeProvider;
  public signer: PrivateKeyWallet;
  public networkId: number;
  public rpcUrl: string;
  public submitTx: boolean;

  public client?: IClient;
  public topic?: string;

  public permittedNetworkId?: number;
  public permittedChainGroup?: number;

  get permittedChain(): string {
    if (typeof this.permittedNetworkId === "undefined") {
      throw new Error("Permitted chain is not set");
    }
    return formatChain(this.permittedNetworkId, this.permittedChainGroup);
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
    this.rpcUrl = opts?.rpcUrl || "http://127.0.0.1:22973";
    this.submitTx = opts?.submitTx || false;
    this.nodeProvider = new NodeProvider(this.rpcUrl);
    this.signer = this.getWallet(this.nodeProvider, opts.privateKey);
  }

  public async changeAccount(privateKey: string) {
    this.setAccount(privateKey);
    await this.updateAccounts();
  }

  public async changeChain(networkId: number, rpcUrl: string) {
    this.setNetworkId(networkId, rpcUrl);
    await this.updateChain();
  }

  public async disconnect() {
    if (!this.client) return;
    if (!this.topic) return;
    await this.client.disconnect({ topic: this.topic, reason: ERROR.USER_DISCONNECTED.format() });
  }

  private setAccount(privateKey: string) {
    this.signer = this.getWallet(this.nodeProvider, privateKey);
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
    const notification = {
      type: providerEvents.changed.accounts,
      data: [formatAccount(this.permittedChain, this.account)],
    };
    await this.client.notify({ topic: this.topic, notification });
  }

  private async emitChainChangedEvent() {
    if (typeof this.client === "undefined") return;
    if (typeof this.topic === "undefined") return;
    const notification = { type: providerEvents.changed.network, data: this.networkId };
    await this.client.notify({ topic: this.topic, notification });
  }

  private getWallet(nodeProvider: NodeProvider, privateKey?: string): PrivateKeyWallet {
    const wallet =
      typeof privateKey !== "undefined"
        ? new PrivateKeyWallet(nodeProvider, privateKey)
        : PrivateKeyWallet.Random(nodeProvider);
    return wallet;
  }

  private getSessionState(): { accounts: string[] } {
    if (typeof this.permittedNetworkId === "undefined") {
      throw new Error("Permitted chains are not set");
    }
    const groupMatched = isCompatibleChainGroup(this.signer.group, this.permittedChainGroup);
    if (groupMatched) {
      return { accounts: [formatAccount(this.permittedChain, this.account)] };
    } else {
      return { accounts: [] };
    }
  }

  private async updateSession() {
    if (typeof this.client === "undefined") return;
    if (typeof this.topic === "undefined") return;
    if (typeof this.permittedNetworkId === "undefined") return;
    await this.client.update({ topic: this.topic, state: this.getSessionState() });
  }

  private async upgradeSession() {
    if (typeof this.client === "undefined") return;
    if (typeof this.topic === "undefined") return;
    await this.client.upgrade({
      topic: this.topic,
      permissions: {
        blockchain: {
          chains: [formatChain(this.networkId, this.permittedChainGroup)],
        },
      },
    });
    await this.updateAccounts();
  }

  private async updateAccounts() {
    await this.updateSession();
    await this.emitAccountsChangedEvent();
  }

  private async updateChain() {
    await this.upgradeSession();
    await this.emitChainChangedEvent();
  }

  private async initialize(opts?: ClientOptions) {
    this.client = await Client.init({ ...opts, controller: true });
    this.registerEventListeners();
  }

  private registerEventListeners() {
    if (typeof this.client === "undefined") {
      throw new Error("Client not initialized");
    }

    // auto-pair
    this.provider.signer.connection.on(SIGNER_EVENTS.uri, async ({ uri }) => {
      if (typeof this.client === "undefined") {
        throw new Error("Client not initialized");
      }
      await this.client.pair({ uri });
    });

    // auto-approve
    this.client.on(CLIENT_EVENTS.session.proposal, async (proposal: SessionTypes.Proposal) => {
      if (typeof this.client === "undefined") {
        throw new Error("Client not initialized");
      }
      const permittedChain = proposal.permissions.blockchain.chains[0];
      if (typeof permittedChain === "undefined") {
        throw new Error("No chain is permitted");
      }
      [this.permittedNetworkId, this.permittedChainGroup] = parseChain(permittedChain);
      const response = { state: this.getSessionState() };
      const session = await this.client.approve({ proposal, response });
      this.topic = session.topic;
    });

    // auto-respond
    this.client.on(
      CLIENT_EVENTS.session.request,
      async (requestEvent: SessionTypes.RequestEvent) => {
        if (typeof this.client === "undefined") {
          throw new Error("Client not initialized");
        }
        const { topic, chainId, request } = requestEvent;

        // ignore if unmatched topic
        if (topic !== this.topic) return;

        try {
          // reject if no present target chain
          if (typeof chainId === "undefined") {
            throw new Error("Missing target chain");
          }

          // reject if unmatched chain
          if (this.permittedChain != chainId) {
            throw new Error(
              `Target chain (${chainId}) does not match active chain (${this.permittedChain})`,
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

          const response = formatJsonRpcResult(request.id, result);
          await this.client.respond({ topic, response });
        } catch (e) {
          const message = e.message || e.toString();
          const response = formatJsonRpcError(request.id, message);
          await this.client.respond({ topic, response });
        }
      },
    );
  }
}
