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
  ApiRequestArguments
} from "@alephium/web3";
import { PROVIDER_METHODS } from "./constants";

type ProviderMethodsTuple = typeof PROVIDER_METHODS;
export type ProviderMethod = ProviderMethodsTuple[number];

interface ProviderMethodsTable extends Record<ProviderMethod, { params: any; result: any }> {
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
export type MethodParams<T extends ProviderMethod> = ProviderMethodsTable[T]["params"];
export type MethodResult<T extends ProviderMethod> = ProviderMethodsTable[T]["result"];

export type ProviderEvent = "session_ping" | "session_update" | "session_delete" | "session_event" | "displayUri" | "accountChanged";

export type NetworkId = number
export type ChainGroup = number | undefined
export interface ChainInfo {
  networkId: NetworkId;
  chainGroup: ChainGroup;
}
