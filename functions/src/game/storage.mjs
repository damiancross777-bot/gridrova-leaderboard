import {upgradeReadability} from "./presentation.mjs";
import { hash, initialState, reduce, upgradeAdPolicy } from "./core.mjs";
const MAIN = "gridrova.state.v1",
  BACKUP = MAIN + ".backup";
export function pack(s) {
  let payload = JSON.stringify(s);
  return JSON.stringify({ payload, checksum: hash(payload) });
}
export function unpack(raw) {
  if (!raw) return null;
  try {
    let { payload, checksum } = JSON.parse(raw);
    if (hash(payload) !== checksum) return null;
    let s = JSON.parse(payload);
    if (
      s.schema !== 1 ||
      !Number.isInteger(s.revision) ||
      !Number.isFinite(s.coins) ||
      s.coins < 0 ||
      !Array.isArray(s.completed) ||
      !s.settings ||
      !s.ads ||
      !s.ledger
    )
      return null;
    return s;
  } catch {
    return null;
  }
}
export class GameStore {
  constructor(adapter) {
    this.adapter = adapter;
    this.state = null;
    this.queue = Promise.resolve();
    this.listeners = new Set();
  }
  async load() {
    let raws = await Promise.all([
        this.adapter.getItem(MAIN),
        this.adapter.getItem(BACKUP),
      ]),
      valid = raws
        .map(unpack)
        .filter(Boolean)
        .sort((a, b) => b.revision - a.revision);
    if (raws.some(Boolean) && !valid.length)
      throw Error(
        "Saved progress could not be read. No data has been overwritten.",
      );
    let previousKeys = [];
    if (!raws.some(Boolean) && this.adapter.getAllKeys) {
      const keys = await this.adapter.getAllKeys();
      const roots = keys.filter(
        (key) => key !== MAIN && key.endsWith(".state.v1"),
      );
      previousKeys = roots.flatMap((key) => [key, key + ".backup"]);
      const previous = await Promise.all(
        previousKeys.map((key) => this.adapter.getItem(key)),
      );
      valid = previous
        .map(unpack)
        .filter(Boolean)
        .sort((a, b) => b.revision - a.revision);
      if (previous.some(Boolean) && !valid.length)
        throw Error(
          "Previous saved progress could not be read. No data has been overwritten.",
        );
    }
    this.state = valid[0] ?? initialState();
    this.state.settings = {
      ...initialState().settings,
      ...this.state.settings,
    };
    this.state = upgradeAdPolicy(upgradeReadability(this.state));
    if (valid.length && previousKeys.length) {
      const encoded = pack(this.state);
      await this.adapter.setItem(BACKUP, encoded);
      await this.adapter.setItem(MAIN, encoded);
      const saved = unpack(await this.adapter.getItem(MAIN));
      if (!saved || saved.revision !== this.state.revision)
        throw Error(
          "Renamed save could not be confirmed. Previous progress is retained.",
        );
      if (this.adapter.removeItem)
        for (const key of previousKeys)
          await this.adapter.removeItem(key).catch(() => {});
    }
    return this.state;
  }
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit() {
    for (let fn of this.listeners) fn(this.state);
  }
  dispatch(action) {
    let run = async () => {
      let next = reduce(this.state, action);
      if (next === this.state) return this.state;
      let old = pack(this.state),
        encoded = pack(next);
      try {
        await this.adapter.setItem(BACKUP, old);
        await this.adapter.setItem(MAIN, encoded);
        let confirmed = unpack(await this.adapter.getItem(MAIN));
        if (!confirmed || confirmed.revision !== next.revision)
          throw Error("Save verification failed");
        this.state = next;
        this.emit();
        return next;
      } catch (e) {
        let saved;
        try {
          saved = unpack(await this.adapter.getItem(MAIN));
        } catch {}
        if (saved && saved.revision >= next.revision) {
          this.state = saved;
          this.emit();
        }
        throw Error(
          "Progress could not be confirmed saved. Please retry. " + e.message,
        );
      }
    };
    let result = this.queue.then(run);
    this.queue = result.catch(() => {});
    return result;
  }
  restore(snapshot) {
    const run = async () => {
      const incoming=unpack(snapshot);
      if(!incoming)throw Error("The backup checksum is invalid.");
      const old=pack(this.state), next={...upgradeAdPolicy(upgradeReadability({...incoming,settings:{...initialState().settings,...incoming.settings}})),revision:this.state.revision+1};
      await this.adapter.setItem(MAIN+".beforeRestore",old);
      try {
        await this.adapter.setItem(BACKUP,old);
        const encoded=pack(next);await this.adapter.setItem(MAIN,encoded);
        const confirmed=unpack(await this.adapter.getItem(MAIN));
        if(!confirmed||confirmed.revision!==next.revision)throw Error("Backup restore could not be confirmed.");
        this.state=next;this.emit();return next;
      } catch(error) {
        try{await this.adapter.setItem(MAIN,old);}catch{}
        throw Error("Restore did not finish. Your previous progress is retained in the recovery checkpoint.");
      }
    };
    const result=this.queue.then(run);this.queue=result.catch(()=>{});return result;
  }
  reset() {
    let run = async () => {
      let s = initialState(),
        encoded = pack(s);
      await this.adapter.setItem(BACKUP, encoded);
      await this.adapter.setItem(MAIN, encoded);
      this.state = s;
      this.emit();
      return s;
    };
    let result = this.queue.then(run);
    this.queue = result.catch(() => {});
    return result;
  }
}
