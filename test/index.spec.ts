import SignClient from '@walletconnect/sign-client';
import 'mocha';
import { expect } from 'chai';

import WalletConnectProvider, { SIGNER_METHODS, SIGNER_EVENTS, SessionMetadata } from '../src/index';

const NETWORK_ID = 4;
const CHAIN_GROUP = 2;

const TEST_PROJECT_ID = process.env.TEST_PROJECT_ID
  ? process.env.TEST_PROJECT_ID
  : '6e2562e43678dd68a9070a62b6d52207';

const TEST_RELAY_URL = process.env.TEST_RELAY_URL
  ? process.env.TEST_RELAY_URL
  : 'wss://relay.walletconnect.com';

const TEST_APP_METADATA = {
  name: 'Test App',
  description: 'Test App for WalletConnect',
  url: 'https://walletconnect.com/',
  icons: ['https://avatars.githubusercontent.com/u/37784886'],
};

const TEST_WALLET_METADATA = {
  name: 'Test Wallet',
  description: 'Test Wallet for WalletConnect',
  url: 'https://walletconnect.com/',
  icons: ['https://avatars.githubusercontent.com/u/37784886'],
};

const TEST_PROVIDER_OPTS = {
  networkId: NETWORK_ID,
  chainGroup: CHAIN_GROUP
};

const TEST_WALLET_CLIENT_OPTS = {
  relayUrl: TEST_RELAY_URL,
  projectId: TEST_PROJECT_ID,
  metadata: TEST_WALLET_METADATA
};

const TEST_DAPP_OPTS = {
  relayUrl: TEST_RELAY_URL,
  projectId: TEST_PROJECT_ID,
  metadata: TEST_APP_METADATA
};

describe('WalletConnectProvider with single chainGroup', function() {
  this.timeout(30_000);

  let signClientWallet: SignClient;
  let providerForDapp: WalletConnectProvider;
  let walletAddress: string;
  let metaWallet: any = undefined;
  let metaDapp: any = undefined;

  before(async () => {
    const signClientDapp = await SignClient.init(TEST_DAPP_OPTS);
    signClientWallet = await SignClient.init(TEST_WALLET_CLIENT_OPTS);

    signClientWallet.on('session_proposal', async (proposal) => {
      metaWallet = await signClientWallet.approve({
        id: proposal.id,
        namespaces: {
          alephium: {
            accounts: [],
            methods: SIGNER_METHODS,
            events: SIGNER_EVENTS
          }
        }
      })
    });

    signClientWallet.on('session_event', async (event) => {
      const result  = {}
      console.log(event);
      await signClientWallet.respond({
        topic: metaWallet.topic,
        response: {
          id: event.id,
          jsonrpc: '2.0',
          result
        }
      })
    });

    providerForDapp = new WalletConnectProvider({
      ...TEST_PROVIDER_OPTS,
      chainGroup: CHAIN_GROUP,
      client: signClientDapp
    });

    const { uri, approval } = await providerForDapp.session.connect({
      requiredNamespaces: {
        alephium: {
          chains: [providerForDapp.permittedChain],
          methods: SIGNER_METHODS,
          events: SIGNER_EVENTS
        }
      }
    });

    if (uri) {
      await signClientWallet.pair({ uri });
    }

    metaDapp = await approval();
    providerForDapp.setSessionMetadata(metaDapp);
  });

  after(async () => {
    await Promise.all([
      new Promise<void>(async resolve => {
        providerForDapp.session.on('session_delete', () => {
          console.log('session deleted for dapp');
          resolve();
        });
        await providerForDapp.session.disconnect({
          topic: metaDapp.topic,
          reason: { code: 1, message: 'testing complete' }
        });
        console.log('disconnected dapp');
        resolve();
      }),
      new Promise<void>(async resolve => {
        signClientWallet.on('session_delete', () => {
          console.log('session deleted for wallet');
          resolve();
        });
        await signClientWallet.disconnect({
          topic: metaWallet.topic,
          reason: { code: 1, message: 'testing complete' }
        });
        console.log('disconnected wallet');
        resolve();
      }),
    ]);
  });

  it('uses a valid method', async (done) => {
  });

  it('rejects an invalid method', () => {
  });

  it('reacts to an arbitrary valid event', () => {
  });

  it('ignores an arbitrary invalid event', () => {
  });
});
