import {
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
  ApiRequestArguments,
  assertType,
  Eq,
} from '@alephium/web3'
import { SignClientTypes } from '@walletconnect/types'
import { RELAY_METHODS } from './constants'

type RelayMethodsTuple = typeof RELAY_METHODS;
export type RelayMethod = RelayMethodsTuple[number];

type RelayMethodsTable = {
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
assertType<Eq<RelayMethod, keyof RelayMethodsTable>>()
export type MethodParams<T extends RelayMethod> = RelayMethodsTable[T]['params'];
export type MethodResult<T extends RelayMethod> = RelayMethodsTable[T]['result'];

type ProviderEventArguments = {
  session_ping: SignClientTypes.EventArguments['session_ping']
  session_update: SignClientTypes.EventArguments['session_update']
  session_delete: SignClientTypes.EventArguments['session_delete']
  session_event: SignClientTypes.EventArguments['session_event']
  displayUri: string
  accountChanged: Account
}
export type ProviderEvent = 'session_ping' | 'session_update' | 'session_delete' | 'session_event' | 'displayUri' | 'accountChanged';
assertType<Eq<ProviderEvent, keyof ProviderEventArguments>>()
export type ProviderEventArgument<T extends ProviderEvent> = ProviderEventArguments[T];

export type NetworkId = number
export type ChainGroup = number | undefined
export interface ChainInfo {
  networkId: NetworkId;
  chainGroup: ChainGroup;
}
