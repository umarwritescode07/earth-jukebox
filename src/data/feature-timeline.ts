import type { FeatureFrame } from "@/contracts/frame";

export type InsertResult = "inserted" | "duplicate" | "stale" | "wrong-source";

export interface TimelineStats {
  inserted: number;
  duplicates: number;
  stale: number;
  wrongSource: number;
  outOfOrder: number;
  evicted: number;
}

/**
 * Sorted, bounded buffer of feature frames for ONE source/asset at a time.
 * - generation: bumped on every reset (source switch, seek in backend mode);
 *   inserts carrying an older generation are rejected as stale.
 * - duplicate frameIds are ignored.
 * - out-of-order arrivals are inserted in presentation-time order.
 */
export class FeatureTimeline {
  private frames: FeatureFrame[] = [];
  private ids = new Set<string>();
  private _generation = 0;
  private sourceId: string | null = null;
  private assetId: string | null = null;
  readonly stats: TimelineStats = { inserted: 0, duplicates: 0, stale: 0, wrongSource: 0, outOfOrder: 0, evicted: 0 };

  constructor(private readonly capacity = 6000) {}

  get generation(): number {
    return this._generation;
  }

  get size(): number {
    return this.frames.length;
  }

  /** Clears everything and starts a new generation for the given source/asset. */
  reset(sourceId: string | null, assetId: string | null): number {
    this.frames = [];
    Object.assign(this.stats, { inserted: 0, duplicates: 0, stale: 0, wrongSource: 0, outOfOrder: 0, evicted: 0 });
    this.ids.clear();
    this.sourceId = sourceId;
    this.assetId = assetId;
    this._generation += 1;
    return this._generation;
  }

  insert(frame: FeatureFrame, generation: number): InsertResult {
    if (generation !== this._generation) {
      this.stats.stale++;
      return "stale";
    }
    if (frame.sourceId !== this.sourceId || frame.assetId !== this.assetId) {
      this.stats.wrongSource++;
      return "wrong-source";
    }
    if (this.ids.has(frame.frameId)) {
      this.stats.duplicates++;
      return "duplicate";
    }
    const idx = this.upperBound(frame.presentationTimeS);
    if (idx < this.frames.length) this.stats.outOfOrder++;
    this.frames.splice(idx, 0, frame);
    this.ids.add(frame.frameId);
    this.stats.inserted++;
    if (this.frames.length > this.capacity) this.evictFarthestFrom(frame.presentationTimeS);
    return "inserted";
  }

  /** Latest frame at or before t, if it is no older than maxAgeS. */
  at(t: number, maxAgeS: number): FeatureFrame | null {
    const idx = this.upperBound(t) - 1;
    if (idx < 0) return null;
    const f = this.frames[idx];
    return t - f.presentationTimeS <= maxAgeS ? f : null;
  }

  /** The frame immediately before the given one in presentation order. */
  previous(frame: FeatureFrame): FeatureFrame | null {
    const idx = this.frames.indexOf(frame);
    return idx > 0 ? this.frames[idx - 1] : null;
  }

  /** True if frames exist covering [from, to] with no gap larger than maxGapS. */
  covers(from: number, to: number, maxGapS: number): boolean {
    const start = this.at(from, maxGapS);
    if (!start) return false;
    let last = start.presentationTimeS;
    for (let i = this.frames.indexOf(start) + 1; i < this.frames.length; i++) {
      const t = this.frames[i].presentationTimeS;
      if (t > to) break;
      if (t - last > maxGapS) return false;
      last = t;
    }
    return to - last <= maxGapS;
  }

  latestTime(): number | null {
    return this.frames.length ? this.frames[this.frames.length - 1].presentationTimeS : null;
  }

  /** Drops frames outside [fromS, toS] (keeps memory bounded around the playhead). */
  prune(fromS: number, toS: number): void {
    const before = this.frames.length;
    this.frames = this.frames.filter((f) => {
      const keep = f.presentationTimeS >= fromS && f.presentationTimeS <= toS;
      if (!keep) this.ids.delete(f.frameId);
      return keep;
    });
    this.stats.evicted += before - this.frames.length;
  }

  all(): readonly FeatureFrame[] {
    return this.frames;
  }

  private upperBound(t: number): number {
    let lo = 0;
    let hi = this.frames.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.frames[mid].presentationTimeS <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private evictFarthestFrom(t: number): void {
    const first = this.frames[0];
    const last = this.frames[this.frames.length - 1];
    const victim = Math.abs(first.presentationTimeS - t) >= Math.abs(last.presentationTimeS - t) ? this.frames.shift() : this.frames.pop();
    if (victim) {
      this.ids.delete(victim.frameId);
      this.stats.evicted++;
    }
  }
}
