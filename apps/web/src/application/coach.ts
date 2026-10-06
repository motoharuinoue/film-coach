// プレゼンテーション層に見せる窓口。ポートを受け取り、ユースケースをまとめて提供する。

import type { CameraAngle } from "../domain/camera";
import type { Drill } from "../domain/drill";
import type { AnalyzedRep, BestRep, Player, Reference, Session } from "../domain/entities";
import { zonesFor, type ZoneSet, type Zones } from "../domain/judgement";
import type { ManualAdjust } from "../domain/weighting";
import { buildFindings } from "./coaching";
import { consistency, evaluateRep, radarScores, releasePoints, repScore, selectBestRep, sessionScore, strengths } from "./evaluation";
import type { AnalysisGateway, FindingWriter, FootageLibrary, ManualAdjustmentStore, PlayerProfileStore, ReferenceRepository, SessionRepository, VideoMetadataReader } from "./ports";
import { defaultManual, weighByApproach, weighReferences, zoneSetOf, type ReferenceWeights } from "./references";

/**
 * 判定に使う 2 つの基準：お手本ゾーン（重み付き分布）と自己ベスト。
 * zones は全部のお手本から作ったもの（表示用）、zoneSet は投げ始めごとのものも含む一式（判定用）
 */
export type Benchmarks = { weights: ReferenceWeights; zones: Zones; zoneSet: ZoneSet; best?: BestRep };

/** 手元の解析サービスから読んだデータ。デモと同じ CoachService に載せる */
export type CoachData = {
  player: Player;
  /** 古い順（デモと同じく、最新は最後） */
  sessions: Session[];
  focus: { session: Session; rep: AnalyzedRep };
  references: Reference[];
  /** 改善点に添えるドリル動画 */
  drills: Drill[];
};

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
    const zoneSet = zoneSetOf(weights, weighByApproach(this.references(), manual));
    return { weights, zones: weights.zones, zoneSet, best: selectBestRep(this.sessions(), this.focus().session.id, zoneSet) };
  }

  /** そのレップの判定に使うゾーン（投げ始めに合うもの） */
  zonesOf(rep: AnalyzedRep, b: Benchmarks) {
    return zonesFor(b.zoneSet, rep.approach);
  }
  evaluate(rep: AnalyzedRep, camera: CameraAngle, b: Benchmarks) {
    return evaluateRep(rep, camera, b.zoneSet, b.best);
  }
  findings(rep: AnalyzedRep, camera: CameraAngle, b: Benchmarks) {
    return buildFindings(rep, this.evaluate(rep, camera, b), this.deps.writer, this.deps.references);
  }
  strengths(rep: AnalyzedRep, camera: CameraAngle, b: Benchmarks) {
    return strengths(this.evaluate(rep, camera, b));
  }
  repScore(rep: AnalyzedRep, b: Benchmarks) {
    return repScore(rep, b.zoneSet);
  }
  sessionScore(s: Session, b: Benchmarks) {
    return sessionScore(s, b.zoneSet);
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
  /** 解析サービスにつなぐ設定があるときだけある（公開デモではない） */
  footage?: FootageLibrary;
  /** 手元のデータを、デモと同じ CoachService に載せる */
  localCoach: (data: CoachData) => CoachService;
  profile: PlayerProfileStore;
};
