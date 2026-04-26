export type Ok = { ok: true };
export type Fail = { ok: false; reason: string };
export type Result = Ok | Fail;

export const ok = (): Ok => ({ ok: true });
export const fail = (reason: string): Fail => ({ ok: false, reason });
