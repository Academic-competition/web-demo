/**
 * GET /api/buzz — SNS 언급 분석 (베타, 옵트인)
 *
 * 이 서비스에서 유일하게 **생성형 AI** 가 응답을 만드는 경로다.
 *   네이버 검색 API(블로그·카페) 실시간 수집 → Claude 가 광고 글을 걸러내며
 *   메뉴·키워드·분위기를 구조화 요약 → BuzzResult 로 반환.
 *
 * 정직성 규칙 (리포트 본문과 구분되는 층):
 *   - 실행마다 결과가 다를 수 있다 → UI 가 "생성형 AI" 라벨을 상시 표기
 *   - 수집 원문(제목·링크·날짜)을 sources 로 함께 반환 — 요약만 던지지 않는다
 *   - 표본 한계(광고 비율·대표성)를 모델이 스스로 진단해 응답에 싣는다
 *   - 키 미설정·수집 0건·모델 거부는 숨기지 않고 available:false + reason
 *
 * 필요 env (모두 서버 전용 — 브라우저에 노출되지 않음):
 *   NAVER_CLIENT_ID / NAVER_CLIENT_SECRET  (developers.naver.com 검색 API)
 *   ANTHROPIC_API_KEY                       (Claude API)
 *   BUZZ_MODEL (선택, 기본 claude-opus-5)
 */
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

import { BuzzResult, BuzzSource, BuzzSummary } from "@/lib/contracts";

export const maxDuration = 60; // LLM 요약 포함 — Vercel 기본 10초로는 부족

const BUZZ_MODEL = process.env.BUZZ_MODEL ?? "claude-opus-5";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6시간 — 비용·지연 절감 (표본이 분 단위로 변하지 않음)

type CacheEntry = { at: number; body: BuzzResult };
const cache = new Map<string, CacheEntry>();

// ------------------------------------------------------------------
// 네이버 검색 API
// ------------------------------------------------------------------
type NaverItem = {
  title: string;
  link: string;
  description: string;
  postdate?: string; // blog 만 제공 (yyyymmdd)
};

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .trim();
}

async function naverSearch(
  kind: "blog" | "cafearticle",
  query: string,
  display: number
): Promise<NaverItem[]> {
  const url = `https://openapi.naver.com/v1/search/${kind}.json?query=${encodeURIComponent(
    query
  )}&display=${display}&sort=sim`;
  const res = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": process.env.NAVER_CLIENT_ID!,
      "X-Naver-Client-Secret": process.env.NAVER_CLIENT_SECRET!,
    },
    signal: AbortSignal.timeout(6000),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`네이버 ${kind} 검색 HTTP ${res.status}`);
  }
  const body = (await res.json()) as { items?: NaverItem[] };
  return body.items ?? [];
}

/** 업종명을 검색어 친화적으로 (예: "한식음식점" → "한식") */
function industryTerm(name: string): string {
  return name.replace(/음식점$/, "").replace(/판매점$/, "").trim() || name;
}

// ------------------------------------------------------------------
// Claude 요약 — 구조화 출력 (BuzzSummary 스키마 강제)
// ------------------------------------------------------------------
const SUMMARY_JSON_SCHEMA = {
  type: "object",
  properties: {
    menus: {
      type: "array",
      items: { type: "string" },
      description: "수집 글에서 실제 언급된 대표 메뉴·상품 (최대 8개, 언급 없으면 빈 배열)",
    },
    keywords: {
      type: "array",
      items: { type: "string" },
      description: "글에서 반복 등장하는 키워드·패턴 (최대 8개)",
    },
    vibe: {
      type: "string",
      description: "분위기·주 고객층·방문 맥락 요약 2~3문장 (수집 글에 근거한 내용만)",
    },
    tips: {
      type: "array",
      items: { type: "string" },
      description: "창업 검토 관점의 시사점 (최대 4개)",
    },
    adRatio: {
      type: ["number", "null"],
      description: "광고·협찬으로 의심되는 글의 비율 추정 (0~1). 판단 불가면 null",
    },
    representativeness: {
      type: "string",
      description: "표본 한계 자가 진단 한 줄 (건수·편중·시점 등)",
    },
  },
  required: ["menus", "keywords", "vibe", "tips", "adRatio", "representativeness"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `당신은 상권 분석 서비스의 SNS 텍스트 분석가입니다. 네이버 블로그·카페 검색 결과(제목+요약문)를 읽고 해당 상권×업종의 소비자 반응 패턴을 구조화합니다.

규칙:
- 수집된 글에 실제로 등장하는 내용만 쓰세요. 글에 없는 메뉴·수치·평판을 지어내지 마세요.
- "협찬", "원고료", "제공받아" 등 광고·협찬 정황이 보이는 글은 분석 근거에서 제외하되, adRatio 로 그 비율을 보고하세요.
- 검색어와 무관한 글(다른 지역·다른 업종)은 무시하세요.
- 표본이 적거나 편중되면 representativeness 에 그 한계를 솔직하게 쓰세요.
- 모든 출력은 한국어로 작성하세요.`;

async function summarize(
  place: string,
  industry: string,
  posts: { title: string; description: string; source: string; date: string | null }[]
): Promise<{ summary: BuzzSummary | null; refused: boolean }> {
  const anthropic = new Anthropic(); // ANTHROPIC_API_KEY 는 env 에서 자동 해석
  const postsText = posts
    .map(
      (p, i) =>
        `${i + 1}. [${p.source}${p.date ? ` ${p.date}` : ""}] ${p.title}\n   ${p.description}`
    )
    .join("\n");

  const res = await anthropic.messages.create({
    model: BUZZ_MODEL,
    max_tokens: 2048,
    // 요약 태스크 — 지연을 줄이기 위해 effort 를 낮춘다 (모델은 유지)
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: SUMMARY_JSON_SCHEMA },
    },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `대상: 서울 "${place}" 상권 × "${industry}" 업종\n수집 글 ${posts.length}건 (네이버 블로그·카페 검색 결과):\n\n${postsText}`,
      },
    ],
  });

  if (res.stop_reason === "refusal") return { summary: null, refused: true };
  const text = res.content.find((b) => b.type === "text")?.text;
  if (!text) return { summary: null, refused: false };
  return { summary: BuzzSummary.parse(JSON.parse(text)), refused: false };
}

// ------------------------------------------------------------------
// 핸들러
// ------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const sangwonCode = sp.get("sangwonCode");
  const industryCode = sp.get("industryCode");
  const sangwonName = sp.get("sangwonName")?.trim() || null;
  const dong = sp.get("dong")?.trim() || null;
  const industryName = sp.get("industryName")?.trim() || null;

  if (!sangwonCode || !industryCode || !industryName || (!sangwonName && !dong)) {
    return NextResponse.json({ message: "필수 파라미터 누락" }, { status: 400 });
  }

  // ---- 키 미설정 → 정직한 비활성 (오류가 아니라 기능 옵트인 상태) ----
  const missing: string[] = [];
  if (!process.env.NAVER_CLIENT_ID || !process.env.NAVER_CLIENT_SECRET)
    missing.push("NAVER_CLIENT_ID/SECRET");
  if (!process.env.ANTHROPIC_API_KEY) missing.push("ANTHROPIC_API_KEY");
  if (missing.length > 0) {
    return NextResponse.json(
      BuzzResult.parse({
        available: false,
        reason: `API 키 미설정 (${missing.join(", ")}) — 서버 환경변수 등록 시 활성화됩니다.`,
      })
    );
  }

  const cacheKey = `${sangwonCode}:${industryCode}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json({ ...hit.body, cached: true });
  }

  const started = Date.now();
  const term = industryTerm(industryName);
  // 상권명이 너무 좁을 수 있어(예: "삼성중앙역 5번") 동네 단위 검색을 병행한다
  const q1 = sangwonName ? `${sangwonName} ${term}` : null;
  const q2 = dong ? `${dong} ${term}` : null;
  const queries = [q1, q2].filter((q): q is string => !!q);

  try {
    // ---- 수집 (블로그 우선 + 카페 보조) ----
    const collected: (BuzzSource & { description: string })[] = [];
    const seen = new Set<string>();
    for (const q of queries) {
      const [blogs, cafes] = await Promise.all([
        naverSearch("blog", q, 10),
        naverSearch("cafearticle", q, 5),
      ]);
      for (const [kind, items] of [
        ["blog", blogs],
        ["cafe", cafes],
      ] as const) {
        for (const it of items) {
          if (seen.has(it.link)) continue;
          seen.add(it.link);
          collected.push({
            title: stripHtml(it.title),
            link: it.link,
            source: kind,
            date: it.postdate ?? null,
            description: stripHtml(it.description),
          });
        }
      }
      if (collected.length >= 20) break; // 첫 검색어로 충분하면 2차 생략
    }

    if (collected.length === 0) {
      const body = BuzzResult.parse({
        available: false,
        reason: "네이버 검색에서 이 상권×업종 관련 글을 찾지 못했습니다.",
        query: queries.join(" / "),
        collectedAt: new Date().toISOString(),
      });
      return NextResponse.json(body);
    }

    // ---- LLM 요약 ----
    const posts = collected.slice(0, 25);
    const { summary, refused } = await summarize(
      sangwonName ?? dong ?? "",
      industryName,
      posts
    );

    const body = BuzzResult.parse({
      available: !!summary,
      reason: summary
        ? null
        : refused
          ? "모델이 이 요청의 요약을 거부했습니다."
          : "모델 응답을 해석하지 못했습니다.",
      query: queries.join(" / "),
      postCount: posts.length,
      collectedAt: new Date().toISOString(),
      model: BUZZ_MODEL,
      cached: false,
      summary,
      sources: posts.map(({ title, link, source, date }) => ({ title, link, source, date })),
      debug: {
        externalUrl: `openapi.naver.com (blog+cafe) → Claude ${BUZZ_MODEL}`,
        externalRequest: { queries, postCount: posts.length },
        externalResponse: null, // 수집 원문은 sources 로 이미 노출
        externalStatus: 200,
        externalDurationMs: Date.now() - started,
        error: null,
      },
    });

    if (body.available) cache.set(cacheKey, { at: Date.now(), body });
    return NextResponse.json(body);
  } catch (err) {
    console.error("[/api/buzz] 실패:", err);
    return NextResponse.json(
      BuzzResult.parse({
        available: false,
        reason: `수집·분석 실패: ${err instanceof Error ? err.message : String(err)}`,
        query: queries.join(" / "),
        collectedAt: new Date().toISOString(),
      })
    );
  }
}
