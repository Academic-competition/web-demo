"use client";
/**
 * BuzzPanel — SNS 언급 분석 (베타)
 *
 * 리포트에서 유일한 **생성형 AI** 블록. 규칙 기반(결정적) 해석 문장과 성질이
 * 다르므로 numbered Section 이 아니라 별도의 점선 카드로 시각적으로 분리한다.
 *
 * 정직성 규칙:
 *   - 자동 실행하지 않는다 — 버튼 옵트인 (요청마다 네이버 검색 + LLM 과금)
 *   - "생성형 AI · 실행마다 달라질 수 있음" 라벨 상시 표기
 *   - 요약만 보여주지 않는다 — 수집 원문(제목·링크·날짜) 전체를 함께 노출
 *   - 표본 한계(건수·광고 의심 비율·대표성 진단)를 요약보다 눈에 띄게 배치
 *   - 키 미설정/수집 실패는 이유와 함께 그대로 표시 (지어내지 않음)
 */
import { useState } from "react";

import type { AnalyzeResult } from "@/lib/contracts";
import { useBuzz } from "@/lib/hooks";

/**
 * 로컬 전용 게이트 — NEXT_PUBLIC_BUZZ_ENABLED=true 인 환경에서만 카드를 렌더한다.
 * 빌드 시점 인라인이므로 Vercel 에 이 변수를 등록하지 않는 한 배포본에는
 * "키 미설정" 카드조차 보이지 않는다 (미완성 기능을 배포본에 노출하지 않기 위한
 * 결정, 2026-08-07). 훅 호출 순서 규칙 때문에 게이트를 래퍼로 분리했다.
 */
export default function BuzzPanel(props: { result: AnalyzeResult }) {
  if (process.env.NEXT_PUBLIC_BUZZ_ENABLED !== "true") return null;
  return <BuzzPanelInner {...props} />;
}

function BuzzPanelInner({ result }: { result: AnalyzeResult }) {
  const [requested, setRequested] = useState(false);
  const params = {
    sangwonCode: result.sangwon.code,
    industryCode: result.industry.code,
    sangwonName: result.sangwon.name,
    dong: result.sangwon.dong,
    industryName: result.industry.name,
  };
  const { data, isFetching, isError, refetch } = useBuzz(params, requested);

  return (
    <section className="rise-in rounded-xl border border-dashed border-gold/50 bg-ink-800/40 px-5 py-5">
      {/* 헤더 — 번호 없는 베타 카드 (규칙 기반 리포트 본문과 층이 다름을 표시) */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="font-[family-name:var(--font-display)] text-[15px] font-semibold tracking-tight text-fg">
          SNS 언급 분석
        </h3>
        <span className="rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-[10px] font-medium text-gold-soft">
          생성형 AI · 베타
        </span>
        <span className="h-px flex-1 bg-gradient-to-r from-gold/30 to-transparent" />
      </div>

      <p className="mb-3 text-[11px] leading-relaxed text-muted">
        네이버 블로그·카페에서 이 상권×업종의 글을 실시간 수집하고, LLM(Claude)이 광고성
        글을 걸러내며 메뉴·키워드·분위기 패턴을 요약합니다.{" "}
        <b className="text-fg/80">리포트 본문의 수치·문장(결정적)과 달리 실행마다 결과가
        다를 수 있는 생성형 요약</b>이며, 수집 원문을 함께 공개합니다.
      </p>

      {/* ── 실행 전 (옵트인) ── */}
      {!requested && (
        <button
          onClick={() => setRequested(true)}
          className="w-full rounded-lg border border-gold/50 bg-gold/10 px-3 py-2.5 text-sm font-medium text-gold-soft transition hover:bg-gold/20"
        >
          수집·분석 실행
          <span className="ml-2 text-[10px] font-normal text-faint">
            버튼을 누를 때만 외부 검색·LLM 을 호출합니다
          </span>
        </button>
      )}

      {/* ── 로딩 ── */}
      {requested && isFetching && (
        <div className="flex items-center gap-2 rounded-lg border border-line/60 bg-ink-700/40 px-3 py-3 text-[11.5px] text-muted">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-gold/60 border-t-transparent" />
          네이버 블로그·카페 수집 → Claude 요약 중… (십수 초 걸릴 수 있습니다)
        </div>
      )}

      {/* ── 네트워크 오류 ── */}
      {requested && isError && (
        <div className="rounded-lg border border-risk/40 bg-risk/10 px-3 py-2.5 text-[11.5px] text-fg/90">
          분석 요청에 실패했습니다.{" "}
          <button onClick={() => refetch()} className="underline decoration-dotted">
            다시 시도
          </button>
        </div>
      )}

      {/* ── 서버가 밝힌 불가 사유 (키 미설정 · 수집 0건 · 모델 거부) ── */}
      {data && !data.available && (
        <div className="rounded-lg border border-line/60 bg-ink-700/40 px-3 py-2.5 text-[11.5px] leading-relaxed text-muted">
          <b className="text-fg/80">분석을 제공할 수 없습니다</b> — {data.reason}
          {data.query && <div className="mt-1 text-[10px] text-faint">검색어: {data.query}</div>}
        </div>
      )}

      {/* ── 결과 ── */}
      {data?.available && data.summary && (
        <div className="space-y-3">
          {/* 표본 정보 — 요약보다 먼저 (무엇을 근거로 한 말인지) */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-faint">
            <span>
              수집 <b className="text-fg/80">{data.postCount}건</b> · 검색어 “{data.query}”
            </span>
            {data.collectedAt && (
              <span>수집 시각 {new Date(data.collectedAt).toLocaleString("ko-KR")}</span>
            )}
            <span>요약 모델 {data.model}</span>
            {data.cached && <span className="rounded bg-ink-700/70 px-1.5 py-px">서버 캐시</span>}
          </div>

          {/* 대표성·광고 오염 경고 — 생성 요약의 신뢰 한계를 먼저 밝힌다 */}
          <div className="rounded-lg border border-caution/40 bg-caution/10 px-3 py-2 text-[11px] leading-relaxed text-fg/90">
            <b>표본 한계</b> — {data.summary.representativeness}
            {data.summary.adRatio != null && (
              <>
                {" "}
                광고·협찬 의심 글 비율 약 <b>{Math.round(data.summary.adRatio * 100)}%</b>
                (분석에서 제외하고 요약).
              </>
            )}
          </div>

          {data.summary.keywords.length > 0 && (
            <div>
              <div className="mb-1 text-[10.5px] font-medium text-muted">반복 키워드·패턴</div>
              <div className="flex flex-wrap gap-1.5">
                {data.summary.keywords.map((k) => (
                  <span
                    key={k}
                    className="rounded-full border border-line/70 bg-ink-700/50 px-2 py-0.5 text-[11px] text-fg/90"
                  >
                    {k}
                  </span>
                ))}
              </div>
            </div>
          )}

          {data.summary.menus.length > 0 && (
            <div>
              <div className="mb-1 text-[10.5px] font-medium text-muted">언급된 메뉴·상품</div>
              <div className="flex flex-wrap gap-1.5">
                {data.summary.menus.map((m) => (
                  <span
                    key={m}
                    className="rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-[11px] text-gold-soft"
                  >
                    {m}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="mb-1 text-[10.5px] font-medium text-muted">분위기·고객층</div>
            <p className="text-[12px] leading-relaxed text-fg/90">{data.summary.vibe}</p>
          </div>

          {data.summary.tips.length > 0 && (
            <div>
              <div className="mb-1 text-[10.5px] font-medium text-muted">창업 관점 시사점</div>
              <ul className="space-y-1 text-[11.5px] leading-relaxed text-fg/90">
                {data.summary.tips.map((t) => (
                  <li key={t} className="flex gap-1.5">
                    <span className="text-gold/70">·</span>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 수집 원문 — 요약의 근거를 감사할 수 있게 전체 공개 */}
          {data.sources && data.sources.length > 0 && (
            <details className="rounded-lg border border-line/50 bg-ink-700/30 px-3 py-2">
              <summary className="cursor-pointer text-[11px] text-muted">
                수집 원문 {data.sources.length}건 보기 (요약의 근거)
              </summary>
              <ul className="mt-2 space-y-1.5">
                {data.sources.map((s) => (
                  <li key={s.link} className="text-[10.5px] leading-snug">
                    <a
                      href={s.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-fg/85 underline decoration-line decoration-dotted underline-offset-2 hover:text-gold-soft"
                    >
                      {s.title}
                    </a>
                    <span className="ml-1.5 text-faint">
                      {s.source === "blog" ? "블로그" : "카페"}
                      {s.date &&
                        ` · ${s.date.slice(0, 4)}.${s.date.slice(4, 6)}.${s.date.slice(6, 8)}`}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <p className="text-[10px] leading-relaxed text-faint">
            이 블록은 생성형 AI 요약입니다 — 같은 요청도 실행마다 표현이 달라질 수 있으며,
            수집 표본({data.postCount}건)이 상권 전체 여론을 대표하지 않습니다. 리포트의
            다른 수치·판정(예측·실측·규칙)과는 산출 층이 다릅니다.
          </p>
        </div>
      )}
    </section>
  );
}
