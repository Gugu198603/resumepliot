import { Fragment } from 'react';
import type { ResumeComparison } from '../types/domain';

const METRIC_ROWS: { key: keyof ResumeComparison['items'][number]['metrics']; label: string }[] = [
  { key: 'sections', label: '模块数' },
  { key: 'risks', label: '风险术语数' },
  { key: 'kbSize', label: 'KB 分块数' },
  { key: 'chars', label: '字符数' }
];

export default function ResumeComparePanel({ comparison }: { comparison: ResumeComparison | null }) {
  if (!comparison) return <p className="empty">勾选至少两份简历，然后点击「对比所选简历」。</p>;
  const { items, commonKeywords, jobMatchScores } = comparison;
  if (!items.length) return <p className="empty">没有可对比的简历数据。</p>;

  const scoreById = new Map((jobMatchScores || []).map((s) => [s.id, s]));

  function bestMetric(key: typeof METRIC_ROWS[number]['key']) {
    return Math.max(...items.map((it) => it.metrics[key]));
  }

  return (
    <div className="compare-stack">
      <div className="detail-header">
        <h3>简历对比</h3>
        <p>{items.length} 份简历并排对比（加粗为该指标领先项）。</p>
      </div>

      <div className="compare-grid" style={{ gridTemplateColumns: `160px repeat(${items.length}, minmax(0, 1fr))` }}>
        <div className="compare-cell compare-head">指标</div>
        {items.map((it) => (
          <div className="compare-cell compare-head" key={it.id}>{it.title}</div>
        ))}

        {jobMatchScores && jobMatchScores.length > 0 && (
          <>
            <div className="compare-cell compare-label">岗位匹配分</div>
            {items.map((it) => {
              const s = scoreById.get(it.id);
              const best = Math.max(...(jobMatchScores || []).map((x) => x.matchScore));
              const isBest = s ? s.matchScore === best : false;
              return (
                <div className="compare-cell" key={it.id}>
                  {s ? <strong className={isBest ? 'compare-best' : ''}>{s.matchScore}/100</strong> : '-'}
                </div>
              );
            })}
          </>
        )}

        {METRIC_ROWS.map((row) => {
          const best = bestMetric(row.key);
          return (
            <Fragment key={row.key}>
              <div className="compare-cell compare-label">{row.label}</div>
              {items.map((it) => {
                const value = it.metrics[row.key];
                const isBest = value === best && best > 0;
                return (
                  <div className="compare-cell" key={`${row.key}-${it.id}`}>
                    <span className={isBest ? 'compare-best' : ''}>{value}</span>
                  </div>
                );
              })}
            </Fragment>
          );
        })}

        <div className="compare-cell compare-label">独有关键词</div>
        {items.map((it) => (
          <div className="compare-cell" key={`uniq-${it.id}`}>
            {it.uniqueKeywords.length
              ? <div className="compare-tags">{it.uniqueKeywords.map((k) => <span key={k} className="jd-tag ok">{k}</span>)}</div>
              : <span className="empty">无</span>}
          </div>
        ))}

        <div className="compare-cell compare-label">风险术语</div>
        {items.map((it) => (
          <div className="compare-cell" key={`risk-${it.id}`}>
            {it.riskTerms.length
              ? <div className="compare-tags">{it.riskTerms.map((k) => <span key={k} className="jd-tag miss">{k}</span>)}</div>
              : <span className="empty">无</span>}
          </div>
        ))}
      </div>

      <div className="detail-block">
        <h4>共有关键词</h4>
        {commonKeywords.length
          ? <div className="compare-tags">{commonKeywords.map((k) => <span key={k} className="jd-tag">{k}</span>)}</div>
          : <p className="empty">这些简历没有共同的技能关键词。</p>}
      </div>
    </div>
  );
}
