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
  addressToGroup,
} from "@alephium/web3";
import { PrivateKeyWallet } from "@alephium/web3-wallet";

import WalletConnectProvider, {
  parseChain,
  formatChain,
  formatAccount,
  PROVIDER_EVENTS,
  ALEPHIUM_NAMESPACE,
  PermittedChainGroups,
  getPermittedChainGroups,
  ChainGroup,
  NetworkId,
  getPermittedChainId
} from "../../src";
import SignClient from "@walletconnect/sign-client";

export interface WalletClientOpts {
  activePrivateKey: string;
  otherPrivateKeys: string[],
  networkId: number;
  rpcUrl: string;
  submitTx?: boolean;
}

export type WalletClientAsyncOpts = WalletClientOpts & SignClientTypes.Options;

export class WalletClient {
  public provider: WalletConnectProvider;
  public nodeProvider: NodeProvider;
  public signer: PrivateKeyWallet;
  public otherSigners: PrivateKeyWallet[];
  public networkId: number;
  public rpcUrl: string;
  public submitTx: boolean;

  public client?: SignClient;
  public topic?: string;

  public namespace?: SessionTypes.Namespace;
  public permittedChainGroups?: PermittedChainGroups

  get currentChain(): string {
    return formatChain(this.networkId, this.group);
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
    const accounts = [this.account]
    this.otherSigners.forEach((signer) => {
      accounts.push(signer.account)
    })
    return accounts
  }

  constructor(provider: WalletConnectProvider, opts: Partial<WalletClientOpts>) {
    this.provider = provider;
    this.networkId = opts?.networkId || 4;
    this.rpcUrl = opts?.rpcUrl || "http://alephium:22973";
    this.submitTx = opts?.submitTx || false;
    this.nodeProvider = new NodeProvider(this.rpcUrl);
    this.signer = this.getWallet(opts.activePrivateKey);
    this.otherSigners = opts.otherPrivateKeys?.map((privateKey) => this.getWallet(privateKey)) ?? []
  }


  public async changeAccount(privateKey: string) {
    const wallet = this.getWallet(privateKey)
    const changedChainId = getPermittedChainId(this.networkId, wallet.group, this.permittedChainGroups)
    if (changedChainId == undefined) {
      throw new Error(`Error changing account, chain ${formatChain(this.networkId, wallet.group)} not permitted`);
    }

    this.signer = wallet
    await this.updateAccounts(changedChainId);
  }

  public async changeChain(networkId: number, rpcUrl: string) {
    const changedChainId = getPermittedChainId(networkId, this.group, this.permittedChainGroups)
    if (changedChainId === undefined) {
      throw new Error(`Error changing network id ${networkId}, chain ${formatChain(networkId, this.group)} not permitted`)
    }

    this.setNetworkId(networkId, rpcUrl);
    await this.updateChainId(changedChainId);
  }

  public async disconnect() {
    if (!this.client) return;
    if (!this.topic) return;

    await this.client.disconnect({
      topic: this.topic,
      reason: {
        code: 6000,
        message: "User disconnected."
      }
    });
  }

  private setNetworkId(networkId: number, rpcUrl: string) {
    if (this.networkId !== networkId) {
      this.networkId = networkId;
    }
    if (this.rpcUrl !== rpcUrl) {
      this.rpcUrl = rpcUrl;
    }
  }

  private async emitAccountsChangedEvent(chainId: string) {
    if (typeof this.client === "undefined") return;
    if (typeof this.topic === "undefined") return;
    const event = {
      name: PROVIDER_EVENTS.accountsChanged,
      data: [formatAccount(chainId, this.account)],
    };

    await this.client.emit({ topic: this.topic, event, chainId });
  }

  private async emitChainChangedEvent(chainId: string) {
    if (typeof this.client === "undefined") return;
    if (typeof this.topic === "undefined") return;
    const event = {
      name: PROVIDER_EVENTS.networkChanged,
      data: this.networkId
    }
    await this.client.emit({ topic: this.topic, event, chainId });
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
    if (typeof this.namespace === "undefined") return;
    await this.client.update({
      topic: this.topic,
      namespaces: {
        "alephium": this.namespace
      }
    });
  }

  private async updateAccounts(chainId: string) {
    await this.updateSession();
    await this.emitAccountsChangedEvent(chainId);
  }

  private async updateChainId(chainId: string) {
    await this.updateSession();
    await this.emitChainChangedEvent(chainId);
  }

  private async initialize(opts?: SignClientTypes.Options) {
    this.client = await SignClient.init(opts);
    this.registerEventListeners();
  }

  private chainAccounts(chains: string[]) {
    return chains.flatMap((chain) => {
      const [_networkId, chainGroup] = parseChain(chain)

      return this.accounts
        .filter((account) => {
          const group = addressToGroup(account.address, 4)
          return chainGroup === -1 || group === (chainGroup as number)
        })
        .map((account) =>
          `${chain}:${account.publicKey}`
        )
    })
  }

  private registerEventListeners() {
    if (typeof this.client === "undefined") {
      throw new Error("Client not initialized");
    }

    // auto-pair
    this.provider.on(PROVIDER_EVENTS.displayUri, async (uri: string) => {
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

        const requiredAlephiumNamespace = requiredNamespaces[ALEPHIUM_NAMESPACE]
        if (requiredAlephiumNamespace === undefined) {
          throw new Error(`${ALEPHIUM_NAMESPACE} namespace is required for session proposal`);
        }

        const requiredChains = requiredNamespaces[ALEPHIUM_NAMESPACE].chains
        if (requiredChains.length === 0) {
          throw new Error(`No chain is permitted in ${ALEPHIUM_NAMESPACE} namespace during session proposal`);
        }

        const chainInfos = requiredChains.map((requiredChain) => {
          const [networkId, chainGroup] = parseChain(requiredChain)
          return { networkId, chainGroup }
        })
        this.permittedChainGroups = getPermittedChainGroups(chainInfos)

        this.namespace = {
          methods: requiredAlephiumNamespace.methods,
          events: requiredAlephiumNamespace.events,
          accounts: this.chainAccounts(requiredAlephiumNamespace.chains),
          extension: requiredAlephiumNamespace.extension?.map((ext) => ({
            methods: ext.methods,
            events: ext.events,
            accounts: this.chainAccounts(ext.chains)
          }))
        }

        const namespaces = { "alephium": this.namespace }
        const { acknowledged } = await this.client.approve({
          id,
          relayProtocol: relays[0].protocol,
          namespaces
        });

        const session = await acknowledged();
        this.topic = session.topic;
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
