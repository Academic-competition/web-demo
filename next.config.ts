import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel 서버리스 함수 번들에 정적 모델 데이터(model-exports/)를 포함시켜
  // /api/* 라우트가 런타임에 fs로 읽을 수 있게 한다. (파일 트레이싱 자동감지 보완)
  outputFileTracingIncludes: {
    "/api/analyze": ["./model-exports/**/*"],
    "/api/heatmap": ["./model-exports/**/*"],
    "/api/meta": ["./model-exports/**/*"],
    "/api/top-industries": ["./model-exports/**/*"],
  },
};

export default nextConfig;
