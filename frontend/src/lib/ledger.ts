import { HttpAgent, type Identity } from "@icp-sdk/core/agent";
import { Principal } from "@icp-sdk/core/principal";
import {
  AccountIdentifier,
  IcpLedgerCanister,
  InsufficientFundsError,
  TxDuplicateError,
  TxTooOldError,
  BadFeeError,
  GenericError,
  TemporarilyUnavailableError,
  isIcpAccountIdentifier,
} from "@icp-sdk/canisters/ledger/icp";
import { GenericError as IcrcGenericError, IcrcLedgerCanister, IcrcTransferError } from "@icp-sdk/canisters/ledger/icrc";
import { canisterEnv } from "./env";

export const ICP_FEE = 10_000n;
const E8S = 100_000_000n;
const MAINNET_LEDGER = "ryjl3-tyaaa-aaaaa-aaaba-cai";

function ledgerId(): Principal {
  return Principal.fromText(canisterEnv()["PUBLIC_CANISTER_ID:icp_ledger"] ?? MAINNET_LEDGER);
}

function icpLedger(identity: Identity): IcpLedgerCanister {
  const agent = HttpAgent.createSync({ identity, rootKey: canisterEnv().IC_ROOT_KEY });
  return IcpLedgerCanister.create({ agent, canisterId: ledgerId() });
}

export function accountId(principal: Principal): string {
  return AccountIdentifier.fromPrincipal({ principal }).toHex();
}

export async function balanceOf(identity: Identity, certified = false): Promise<bigint> {
  return icpLedger(identity).accountBalance({
    accountIdentifier: AccountIdentifier.fromPrincipal({ principal: identity.getPrincipal() }),
    certified,
  });
}

export function formatIcp(e8s: bigint, maxDecimals = 4): string {
  const whole = e8s / E8S;
  const frac = (e8s % E8S).toString().padStart(8, "0").slice(0, maxDecimals).replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}${frac ? `.${frac}` : ""}`;
}

export function parseIcp(text: string): bigint | null {
  const m = /^\s*(\d{0,12})(?:\.(\d{0,8}))?\s*$/.exec(text);
  if (!m || (!m[1] && !m[2])) return null;
  return BigInt(m[1] || "0") * E8S + BigInt((m[2] ?? "").padEnd(8, "0") || "0");
}

export type Destination =
  | { kind: "principal"; principal: Principal }
  | { kind: "account"; account: AccountIdentifier };

export function parseDestination(text: string): Destination | null {
  const value = text.trim();
  if (isIcpAccountIdentifier(value)) return { kind: "account", account: AccountIdentifier.fromHex(value) };
  try {
    const principal = Principal.fromText(value);
    if (principal.isAnonymous()) return null;
    return { kind: "principal", principal };
  } catch {
    return null;
  }
}

export async function sendIcp(identity: Identity, to: Destination, amount: bigint): Promise<bigint> {
  const ledger = icpLedger(identity);
  const createdAt = BigInt(Date.now()) * 1_000_000n;
  if (to.kind === "account") return ledger.transfer({ to: to.account, amount, fee: ICP_FEE, createdAt });
  return ledger.icrc1Transfer({ to: { owner: to.principal, subaccount: [] }, amount, fee: ICP_FEE, createdAt });
}

export async function approveIcp(identity: Identity, spender: Principal, amount: bigint): Promise<bigint> {
  const now = BigInt(Date.now()) * 1_000_000n;
  return icpLedger(identity).icrc2Approve({
    spender: { owner: spender, subaccount: [] },
    amount,
    fee: ICP_FEE,
    createdAt: now,
    expires_at: now + 10n * 60n * 1_000_000_000n,
  });
}

export function ledgerMessage(error: unknown): string {
  if (error instanceof InsufficientFundsError) return `Not enough ICP (balance ${formatIcp(error.balance)} ICP)`;
  if (error instanceof TxDuplicateError) return "This transfer was already submitted";
  if (error instanceof TxTooOldError) return "Request expired; try again";
  if (error instanceof BadFeeError) return "Ledger fee changed; refresh and try again";
  if (error instanceof TemporarilyUnavailableError) return "Ledger temporarily unavailable; try again shortly";
  if (error instanceof GenericError) return error.message || "Ledger rejected the request";
  return error instanceof Error ? error.message : String(error);
}

// Soon-launched tokens run DFINITY's ICRC-1/ICRC-2 ledger: 8 decimals, fee 0.0001.
export const TOKEN_FEE = 10_000n;

function tokenLedger(identity: Identity, ledger: Principal): IcrcLedgerCanister {
  const agent = HttpAgent.createSync({ identity, rootKey: canisterEnv().IC_ROOT_KEY });
  return IcrcLedgerCanister.create({ agent, canisterId: ledger });
}

export async function tokenBalance(identity: Identity, ledger: Principal): Promise<bigint> {
  return tokenLedger(identity, ledger).balance({ owner: identity.getPrincipal(), certified: false });
}

export async function approveToken(identity: Identity, ledger: Principal, spender: Principal, amount: bigint): Promise<bigint> {
  const now = BigInt(Date.now()) * 1_000_000n;
  return tokenLedger(identity, ledger).approve({
    spender: { owner: spender, subaccount: [] },
    amount,
    fee: TOKEN_FEE,
    created_at_time: now,
    expires_at: now + 10n * 60n * 1_000_000_000n,
  });
}

export async function sendToken(identity: Identity, ledger: Principal, to: Principal, amount: bigint): Promise<bigint> {
  return tokenLedger(identity, ledger).transfer({
    to: { owner: to, subaccount: [] },
    amount,
    fee: TOKEN_FEE,
    created_at_time: BigInt(Date.now()) * 1_000_000n,
  });
}

export function tokenMessage(error: unknown, symbol: string): string {
  if (error instanceof IcrcTransferError) {
    const kind = Object.keys(error.errorType ?? {})[0];
    const detail = (error.errorType as Record<string, { balance?: bigint }>)[kind ?? ""];
    if (kind === "InsufficientFunds") return `Not enough ${symbol}${detail?.balance !== undefined ? ` (balance ${formatIcp(detail.balance)})` : ""}`;
    if (kind === "Duplicate") return "This transfer was already submitted";
    if (kind === "TooOld") return "Request expired; try again";
    if (kind === "BadFee") return "Ledger fee changed; refresh and try again";
    if (kind === "TemporarilyUnavailable") return "Ledger temporarily unavailable; try again shortly";
    return error.message || `${symbol} ledger rejected the request`;
  }
  if (error instanceof IcrcGenericError) return error.message || `${symbol} ledger rejected the request`;
  return error instanceof Error ? error.message : String(error);
}
