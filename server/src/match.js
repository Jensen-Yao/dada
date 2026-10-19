// v2.9 MT-01：确定性多维匹配评分模型（纯函数，同输入必同输出）
// 公式与空值剔除规则见 docs/product-spec.md §H.0：
//   match_score = round( 100 × Σ(wᵢ × sᵢ) / Σ(wᵢ) )  clamp 0-100
//   输入缺失的维度不参与 Σwi·si 也不参与 Σwi（权重分摊给其余维度）；全剔除 → null

// 六维权重（H.0 表；MT-05-2 断言 Σ=100）
export const WEIGHTS = { tags: 30, mbti: 15, city: 20, category: 20, credit: 10, active: 5 };

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// ---------- H.1 MBTI 兼容矩阵（每维度命中=25%） ----------
// ① E/I 互补25% / 同类15%；② N/S 同质25% / 错配10%；③ T/F 互补25% / 同类15%；④ J/P 互补25% / 同类15%
// 任一方为空串（或非法 4 字母组合）→ 返回 null，表示该维度整体剔除
const MBTI_RE = /^[EI][NS][TF][JP]$/;

export function mbtiScore(a, b) {
  const x = String(a || '').toUpperCase();
  const y = String(b || '').toUpperCase();
  if (!MBTI_RE.test(x) || !MBTI_RE.test(y)) return null;
  // 用整数百分比累加再除 100，避免 0.15/0.25 浮点直接相加的误差
  let pct = 0;
  pct += x[0] === y[0] ? 15 : 25; // E/I：同类15，互补25
  pct += x[1] === y[1] ? 25 : 10; // N/S：同质25，错配10
  pct += x[2] === y[2] ? 15 : 25; // T/F：同类15，互补25
  pct += x[3] === y[3] ? 15 : 25; // J/P：同类15，互补25
  return pct / 100; // 0.55 ~ 1.0
}

// 同城子分：完全相等=1；前 2 字相同（同省简化判定）=0.6；否则 0。
// 任一方城市为空 → null（剔除该维度）
export function cityScore(myCity, postCity) {
  const a = String(myCity || '');
  const b = String(postCity || '');
  if (!a || !b) return null;
  if (a === b) return 1;
  return a.slice(0, 2) === b.slice(0, 2) ? 0.6 : 0;
}

// ---------- H.0 总评分 ----------
// input: {
//   myTags[], authorTags[],        兴趣标签 Jaccard（任一方为空→剔除）
//   myMbti, authorMbti,            MBTI 兼容（任一方为空/非法→剔除）
//   myCity, postCity,              同城/同省（任一方为空→剔除）
//   myCatHistory[], postCategory,  分类偏好：postCategory 在历史中占比（历史为空→剔除）
//   authorCredit,                  搭力值 clamp((credit-300)/500,0,1)（非数值→剔除）
//   authorActive,                  作者 7 日内发帖或评论 bool（非布尔→剔除）
// }
export function matchScore(input) {
  const parts = []; // [wᵢ, sᵢ]，仅收录"可用维度"

  // 兴趣标签 Jaccard
  const myTags = Array.isArray(input.myTags) ? input.myTags : [];
  const authorTags = Array.isArray(input.authorTags) ? input.authorTags : [];
  if (myTags.length && authorTags.length) {
    const inter = myTags.filter((t) => authorTags.includes(t));
    const union = new Set([...myTags, ...authorTags]);
    parts.push([WEIGHTS.tags, union.size ? inter.length / union.size : 0]);
  }

  // MBTI 兼容性
  const mbti = mbtiScore(input.myMbti, input.authorMbti);
  if (mbti !== null) parts.push([WEIGHTS.mbti, mbti]);

  // 同城 / 同省
  const city = cityScore(input.myCity, input.postCity);
  if (city !== null) parts.push([WEIGHTS.city, city]);

  // 分类偏好：该帖分类在我"参加+发布"历史分类总次数中的占比
  const hist = Array.isArray(input.myCatHistory) ? input.myCatHistory : [];
  if (hist.length) {
    parts.push([WEIGHTS.category, hist.filter((c) => c === input.postCategory).length / hist.length]);
  }

  // 搭力值信用（有默认值，DB 侧恒可用；纯函数侧仅对有限数值计分）
  const credit = Number(input.authorCredit);
  if (Number.isFinite(credit)) {
    parts.push([WEIGHTS.credit, clamp01((credit - 300) / 500)]);
  }

  // 活跃度：作者 7 日内发过帖或评论（调用方 SQL EXISTS 判定后传入）
  if (typeof input.authorActive === 'boolean') {
    parts.push([WEIGHTS.active, input.authorActive ? 1 : 0]);
  }

  const wSum = parts.reduce((s, [w]) => s + w, 0);
  if (!wSum) return null; // 全部剔除 → 不出评分（调用方走冷启动）
  const weighted = parts.reduce((s, [w, v]) => s + w * v, 0) / wSum;
  return Math.max(0, Math.min(100, Math.round(100 * weighted)));
}
