// プレゼンテーション層に見せる窓口。ポートを受け取り、ユースケースをまとめて提供する。

import type { CameraAngle } from "../domain/camera";
import type { AnalyzedRep, BestRep, Session } from "../domain/entities";
import type { Zones } from "../domain/judgement";
import type { ManualAdjust } from "../domain/weighting";
import { buildFindings } from "./coaching";
import { consistency, evaluateRep, radarScores, releasePoints, repScore, selectBestRep, sessionScore, strengths } from "./evaluation";
import type { AnalysisGateway, FindingWriter, ManualAdjustmentStore, ReferenceRepository, SessionRepository, VideoMetadataReader } from "./ports";
import { defaultManual, weighReferences, type ReferenceWeights } from "./references";

/** 判定に使う 2 つの基準：お手本ゾーン（重み付き分布）と自己ベスト */
export type Benchmarks = { weights: ReferenceWeights; zones: Zones; best?: BestRep };

export class CoachService {
  constructor(private readonly deps: { sessions: SessionRepository; references: ReferenceRepository; writer: FindingWriter }) {}

  player() {
    return this.deps.sessions.player();
  }
  sessions() {
    return this.deps.sessions.list();
  }
  session(id: string) {
    return this.deps.sessions.get(id);
  }
  focus() {
    return this.deps.sessions.focus();
  }
  references() {
    return this.deps.references.list();
  }
  reference(id: string) {
    return this.deps.references.get(id);
  }

  defaultManual() {
    return defaultManual(this.references());
  }

  benchmarks(manual: Record<string, ManualAdjust> = this.defaultManual()): Benchmarks {
    const weights = weighReferences(this.references(), manual);
    return { weights, zones: weights.zones, best: selectBestRep(this.sessions(), this.focus().session.id, weights.zones) };
  }

  evaluate(rep: AnalyzedRep, camera: CameraAngle, b: Benchmarks) {
    return evaluateRep(rep, camera, b.zones, b.best);
  }
  findings(rep: AnalyzedRep, camera: CameraAngle, b: Benchmarks) {
    return buildFindings(rep, this.evaluate(rep, camera, b), this.deps.writer, this.deps.references);
  }
  strengths(rep: AnalyzedRep, camera: CameraAngle, b: Benchmarks) {
    return strengths(this.evaluate(rep, camera, b));
  }
  repScore(rep: AnalyzedRep, b: Benchmarks) {
    return repScore(rep, b.zones);
  }
  sessionScore(s: Session, b: Benchmarks) {
    return sessionScore(s, b.zones);
  }
  consistency(s: Session) {
    return consistency(s);
  }
  releasePoints(s: Session) {
    return releasePoints(s);
  }
  radar(rep: AnalyzedRep, s: Session, b: Benchmarks) {
    return radarScores(this.evaluate(rep, s.camera, b), consistency(s).score);
  }
}

/** プレゼンテーション層が受け取るサービス一式 */
export type Services = {
  coach: CoachService;
  manualStore: ManualAdjustmentStore;
  analysis: AnalysisGateway;
  videoMeta: VideoMetadataReader;
};
