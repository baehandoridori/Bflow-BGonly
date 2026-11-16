// 레이어 엔진 v0.4.4 (gptjobs.js) 의 타입: PD · GPT Image 에 보내는 글 (HTML 과 같은 글).
export function inventoryPrompt2(pw: number, ph: number, notes?: string): string;
export const INVENTORY_SCHEMA2: Record<string, unknown>;
export function describePrompt(pw: number, ph: number, box: number[], nameKo?: string): string;
export const DESCRIBE_SCHEMA: Record<string, unknown>;
export function depthPrompt(objs: Array<{ name: string; en: string }>, pairs: Array<[number, number]>, pw: number, ph: number): string;
export const DEPTH_SCHEMA: Record<string, unknown>;
export function platePrompt(inv: { groups: Array<{ en: string }>; background_en: string }): string;
export const plateMaskedPrompt: (p: string) => string;
export function plateAddPrompt(objs: Array<{ en: string }>): string;
