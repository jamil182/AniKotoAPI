export interface LabelState { source: string; last: string }
export interface SynopsisState { source: string; translated: string; attempt: number }
export interface SynopsisJob { element: HTMLElement; source: string; slug: string; version: number; signal: AbortSignal }
