import type { CategoryId, TldKind } from "./categories";

export type Status = "pending" | "free" | "taken" | "forsale" | "unknown";

export type Confidence = "confirmed" | "likely";

export type Via = "dns" | "rdap" | "whois" | "dns+rdap" | "dns+whois";

export interface Market {
  name: string;
  url: string;
}

export interface TldResult {
  /** ASCII suffix without leading dot, e.g. "com", "co.uk", "xn--p1ai" */
  tld: string;
  /** Human readable suffix (IDN decoded), e.g. "рф" */
  tldUnicode: string;
  /** Full ASCII domain that was checked */
  domain: string;
  /** Full domain for display (IDN decoded) */
  domainUnicode: string;
  status: Status;
  confidence: Confidence;
  /** How the verdict was reached */
  via: Via;
  /** Registration price for the first year, USD */
  price?: number;
  renew?: number;
  transfer?: number;
  /** Nameservers found (only for taken/forsale) */
  ns?: string[];
  /** Detected aftermarket marketplace */
  market?: Market;
  /** Lower = more popular, used for ordering */
  rank: number;
  /** Number of labels in the suffix: "com" = 1, "co.uk" = 2 */
  labels: number;
  /** Character length of the suffix (IDN counted in its unicode form) */
  length: number;
  kind: TldKind;
  categories: CategoryId[];
}

export interface ScanMeta {
  type: "meta";
  total: number;
  query: string;
  pricedCount: number;
}

export interface ScanResultMsg extends TldResult {
  type: "result";
}

export interface ScanUpdateMsg {
  type: "update";
  tld: string;
  /** Absent when no registry could answer — the row keeps its DNS-based guess. */
  status?: Status;
  confidence?: Confidence;
  via?: Via;
}

export interface ScanPhase {
  type: "phase";
  phase: "verify";
  pending: number;
}

export interface ScanDone {
  type: "done";
  scanned: number;
  ms: number;
}

export interface ScanError {
  type: "error";
  message: string;
}

export type ScanMessage =
  | ScanMeta
  | ScanResultMsg
  | ScanUpdateMsg
  | ScanPhase
  | ScanDone
  | ScanError;
