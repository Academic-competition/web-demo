"use client";
/**
 * DemographicsChart — 유동인구 연령대 구성 미니 차트 (보조 지표)
 *
 * 스타일·툴팁·값 라벨은 SliceBarChart 에 위임한다. 예전에는 같은 차트를 두 벌
 * 복사해 두고 있었고, 그래서 8/7 툴팁 가독성 수정을 두 곳에 각각 넣어야 했다
 * (한쪽을 빠뜨리면 바로 어긋난다). 연령대 라벨 매핑도 SliceBarChart 가 갖고 있다.
 */
import { SliceBarChart } from "./DetailCharts";

export default function DemographicsChart({
  data,
}: {
  data: { ageBand: string; ratio: number }[];
}) {
  return (
    <SliceBarChart data={data.map((d) => ({ label: d.ageBand, ratio: d.ratio }))} />
  );
}
