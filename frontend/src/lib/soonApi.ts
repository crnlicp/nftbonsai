// Read-only client for Soon (soonlaunchpad.fun) canisters. Every call is a free public query.
// Soon lives on mainnet only, so reads always go to the mainnet gateway, even from a local build.
import { Actor, HttpAgent } from "@icp-sdk/core/agent";
import type { IDL } from "@icp-sdk/core/candid";
import type { Principal } from "@icp-sdk/core/principal";

const SOON_HOST = "https://icp-api.io";
export const SOON_FACTORY = "3jz7z-jqaaa-aaaab-ag6kq-cai";
export const SOON_SOCIAL = "phejn-2yaaa-aaaab-ahaaa-cai";

export type Phase = { Trading: null } | { Graduating: { last_error: [] | [string] } } | { Graduated: { pool: Principal } };
export type MarketInfo = {
  price: number; progress_bps: number; raised: bigint; volume_base: bigint; traders: bigint; trades: bigint;
  mined: bigint; mine_supply: bigint; active_rigs: number; sold: bigint; curve_supply: bigint; created_at: bigint;
  phase: Phase; base: { symbol: string; decimals: number; ledger: Principal };
  meta: { name: string; symbol: string; description: string };
};
export type Trade = { at: bigint; id: bigint; buy: boolean; who: Principal; base: bigint; tokens: bigint; price: number };
export type Candle = { t: bigint; open: number; high: number; low: number; close: number; volume: bigint };
export type MinerStat = { owner: Principal; rigs: number; active: [] | [number]; locked: bigint; burned: bigint };
export type UsdPrice = { ledger: Principal; symbol: string; usd: number; at: bigint };
export type Post = { at: bigint; id: bigint; author: Principal; text: string; deleted: boolean; hidden: boolean; replies: number; pinned: boolean };

const marketIdl: IDL.InterfaceFactory = ({ IDL }) => {
  const GradStep = IDL.Variant({
    Release: IDL.Record({ pool: IDL.Principal, positions: IDL.Vec(IDL.Nat) }),
    Mint: IDL.Record({ pool: IDL.Principal }),
    Deposit: IDL.Record({ pool: IDL.Principal }),
    MintLp: IDL.Record({ pool: IDL.Principal }),
    RequestPool: IDL.Null,
  });
  const Phase = IDL.Variant({
    Graduating: IDL.Record({ last_error: IDL.Opt(IDL.Text), step: GradStep }),
    Graduated: IDL.Record({ pool: IDL.Principal, positions: IDL.Vec(IDL.Nat) }),
    Trading: IDL.Null,
  });
  const Info = IDL.Record({
    price: IDL.Float64, progress_bps: IDL.Nat32, raised: IDL.Nat, volume_base: IDL.Nat, traders: IDL.Nat64,
    trades: IDL.Nat64, mined: IDL.Nat, mine_supply: IDL.Nat, active_rigs: IDL.Nat32, sold: IDL.Nat,
    curve_supply: IDL.Nat, created_at: IDL.Nat64, phase: Phase,
    base: IDL.Record({ symbol: IDL.Text, decimals: IDL.Nat8, ledger: IDL.Principal }),
    meta: IDL.Record({ name: IDL.Text, symbol: IDL.Text, description: IDL.Text }),
  });
  const Trade = IDL.Record({
    at: IDL.Nat64, id: IDL.Nat64, buy: IDL.Bool, who: IDL.Principal, base: IDL.Nat, tokens: IDL.Nat, price: IDL.Float64,
  });
  const Candle = IDL.Record({
    t: IDL.Nat64, open: IDL.Float64, high: IDL.Float64, low: IDL.Float64, close: IDL.Float64, volume: IDL.Nat,
  });
  const Miner = IDL.Record({
    owner: IDL.Principal, rigs: IDL.Nat32, active: IDL.Opt(IDL.Nat32), locked: IDL.Nat, burned: IDL.Nat,
  });
  return IDL.Service({
    info: IDL.Func([], [Info], ["query"]),
    trades: IDL.Func([IDL.Nat32], [IDL.Vec(Trade)], ["query"]),
    candles: IDL.Func([IDL.Bool, IDL.Nat64], [IDL.Vec(Candle)], ["query"]),
    miners: IDL.Func([], [IDL.Vec(Miner)], ["query"]),
  });
};

const factoryIdl: IDL.InterfaceFactory = ({ IDL }) => IDL.Service({
  prices: IDL.Func([], [IDL.Vec(IDL.Record({ ledger: IDL.Principal, symbol: IDL.Text, usd: IDL.Float64, at: IDL.Nat64 }))], ["query"]),
  names: IDL.Func([IDL.Vec(IDL.Principal)], [IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Text))], ["query"]),
});

const socialIdl: IDL.InterfaceFactory = ({ IDL }) => IDL.Service({
  thread: IDL.Func([IDL.Principal, IDL.Opt(IDL.Nat64), IDL.Nat32], [IDL.Vec(IDL.Record({
    at: IDL.Nat64, id: IDL.Nat64, author: IDL.Principal, text: IDL.Text, deleted: IDL.Bool, hidden: IDL.Bool,
    replies: IDL.Nat32, pinned: IDL.Bool,
  }))], ["query"]),
});

type MarketActor = {
  info: () => Promise<MarketInfo>;
  trades: (n: number) => Promise<Trade[]>;
  candles: (hourly: boolean, sinceNs: bigint) => Promise<Candle[]>;
  miners: () => Promise<MinerStat[]>;
};
type FactoryActor = {
  prices: () => Promise<UsdPrice[]>;
  names: (ps: Principal[]) => Promise<[Principal, string][]>;
};
type SocialActor = { thread: (market: Principal, before: [] | [bigint], n: number) => Promise<Post[]> };

let agent: HttpAgent | undefined;
const soonAgent = () => (agent ??= HttpAgent.createSync({ host: SOON_HOST }));

export const soonMarket = (market: string) => Actor.createActor<MarketActor>(marketIdl, { agent: soonAgent(), canisterId: market });
export const soonFactory = () => Actor.createActor<FactoryActor>(factoryIdl, { agent: soonAgent(), canisterId: SOON_FACTORY });
export const soonSocial = () => Actor.createActor<SocialActor>(socialIdl, { agent: soonAgent(), canisterId: SOON_SOCIAL });
