// @arcora/router — off-chain orchestration brain for the chain-agnostic CCTP V2
// payment router. Public surface; nothing here ever holds user funds.
export {
  STABLE_DECIMALS,
  type Money,
  money,
  parseUnits,
  formatUnits,
  parseAmount,
  isMoney,
} from "./money";
export {
  type PayoutToken,
  type SettlementPath,
  type RouteInput,
  selectRoute,
} from "./selectRoute";
export {
  type ChainConfig,
  CHAINS,
  CCTP_V2_TESTNET,
  CCTP_V2_MAINNET,
  CCTP_FINALITY,
  IRIS_API,
  DEPLOY_TESTNET_KEYS,
  getChainByDomain,
  getChainByKey,
  getChainById,
  requireChainByDomain,
  getTestnets,
} from "./chains";
export {
  type SettlementState,
  type SettlementEvent,
  type TransitionError,
  transition,
  isTerminal,
  INITIAL_STATE,
} from "./stateMachine";
export {
  type IrisStatus,
  type IrisMessage,
  type IrisOptions,
  type PollOptions,
  getMessages,
  waitForAttestation,
} from "./iris";
export {
  type LifiQuoteParams,
  type SwapPlan,
  assertSwapOnly,
  getSwapPlan,
} from "./lifi";
export {
  type SettlementRecord,
  type Store,
  type CreateInput,
  MemoryStore,
  Orchestrator,
} from "./orchestrator";

export { paymentEscrowAbi, settlementReceiverAbi } from "./abi";
