/**
 * PlaybackClock — the single source of presentation time.
 *
 * Presentation time (seconds on the NASA media timeline) is derived from the
 * Web Audio clock through a linear anchor:
 *
 *   presentation(t_audio) = anchorPres + (t_audio - anchorAudio) * rate   (while running)
 *
 * Every consumer — sound scheduling, the timeline UI, feature lookup, text
 * updates — reads this clock. The NASA video is the visual truth: the
 * controller "disciplines" the clock to decoded-frame times reported by
 * requestVideoFrameCallback, re-anchoring when drift exceeds a threshold.
 * React renders and timers never advance it.
 */
export interface DriftSample {
  driftS: number;
  corrected: boolean;
}

export class PlaybackClock {
  private anchorAudio = 0;
  private anchorPres = 0;
  private _rate = 1;
  private _running = false;
  private _durationS = 0;

  constructor(private readonly audioNow: () => number) {}

  get running(): boolean {
    return this._running;
  }
  get rate(): number {
    return this._rate;
  }
  get durationS(): number {
    return this._durationS;
  }
  set durationS(d: number) {
    this._durationS = Math.max(0, d);
  }

  /** Presentation time at a given audio-context time (defaults to now). */
  presentationAt(audioTime = this.audioNow()): number {
    if (!this._running) return this.anchorPres;
    return this.anchorPres + (audioTime - this.anchorAudio) * this._rate;
  }

  now(): number {
    return this.presentationAt();
  }

  /** Audio-context time at which a given presentation time occurs (only meaningful while running). */
  audioTimeFor(presentationS: number): number {
    return this.anchorAudio + (presentationS - this.anchorPres) / this._rate;
  }

  start(fromPresentationS = this.anchorPres): void {
    this.anchorPres = fromPresentationS;
    this.anchorAudio = this.audioNow();
    this._running = true;
  }

  pause(): void {
    this.anchorPres = this.presentationAt();
    this.anchorAudio = this.audioNow();
    this._running = false;
  }

  seek(presentationS: number): void {
    this.anchorPres = presentationS;
    this.anchorAudio = this.audioNow();
  }

  setRate(rate: number): void {
    if (!(rate > 0)) throw new Error("rate must be > 0");
    const p = this.presentationAt();
    this.anchorPres = p;
    this.anchorAudio = this.audioNow();
    this._rate = rate;
  }

  /**
   * Compare an observed media time (e.g. a decoded video frame at observedAudioTime)
   * with the clock; re-anchor to the observation when |drift| > thresholdS.
   */
  discipline(observedPresentationS: number, observedAudioTime: number, thresholdS: number): DriftSample {
    const expected = this.presentationAt(observedAudioTime);
    const driftS = expected - observedPresentationS;
    if (this._running && Math.abs(driftS) > thresholdS) {
      this.anchorPres = observedPresentationS;
      this.anchorAudio = observedAudioTime;
      return { driftS, corrected: true };
    }
    return { driftS, corrected: false };
  }
}
