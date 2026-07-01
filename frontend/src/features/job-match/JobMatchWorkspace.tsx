import type { JdMatchResult, JobDescription, JobMatch } from '../../types/domain';

interface JobMatchWorkspaceProps {
  jobs: JobDescription[];
  selectedJobId: string;
  jdUrl: string;
  jdText: string;
  result: JdMatchResult | null;
  history: JobMatch[];
  canMatch: boolean;
  onPickJob: (id: string) => void;
  onUrlChange: (value: string) => void;
  onTextChange: (value: string) => void;
  onFetchUrl: () => void;
  onMatch: () => void;
}

export default function JobMatchWorkspace({
  jobs,
  selectedJobId,
  jdUrl,
  jdText,
  result,
  history,
  canMatch,
  onPickJob,
  onUrlChange,
  onTextChange,
  onFetchUrl,
  onMatch
}: JobMatchWorkspaceProps) {
  return (
    <div className="display-section">
      {jobs.length > 0 ? (
        <div className="jd-input-row">
          <select className="jd-job-select" value={selectedJobId} onChange={(event) => onPickJob(event.target.value)}>
            <option value="">— 从已抓取岗位库选择 —</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>{[job.title, job.company].filter(Boolean).join(' · ') || job.id}</option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="jd-input-row">
        <input className="jd-url-input" value={jdUrl} onChange={(event) => onUrlChange(event.target.value)} placeholder="粘贴岗位链接，自动抓取 JD 正文（动态渲染站点可能抓不到）。" />
        <button onClick={onFetchUrl} disabled={!jdUrl.trim()}>抓取链接</button>
      </div>
      <div className="jd-input-row">
        <textarea className="jd-input" value={jdText} onChange={(event) => onTextChange(event.target.value)} placeholder="粘贴目标岗位的 JD（每行一条要求效果最佳），点击对比。" />
        <button onClick={onMatch} disabled={!canMatch}>对比岗位匹配度</button>
      </div>
      {result ? (
        <div className="jd-result">
          <div className="jd-score-row">
            <div className="jd-score-ring"><strong>{result.matchScore}</strong><small>/ 100</small></div>
            <div className="jd-score-meta">
              <p>匹配 <strong>{(result.matched || []).length}</strong> 项 · 缺口 <strong>{(result.gaps || []).length}</strong> 项</p>
              <span className={result.mode === 'live' ? 'chip ok' : 'chip'}>{result.mode === 'live' ? 'LLM 分析' : '向量兜底'}</span>
            </div>
          </div>
          {result.gapReport ? (
            <div className="jd-gap-report">
              <h5>差距报告</h5>
              <p className="jd-gap-summary">{result.gapReport.summary}</p>
              <div className="jd-keyword-groups">
                <KeywordGroup label="命中关键词" values={result.gapReport.matchedKeywords || []} state="ok" />
                <KeywordGroup label="缺失关键词" values={result.gapReport.missingKeywords || []} state="miss" />
              </div>
            </div>
          ) : null}
          {result.evidenceSummary ? (
            <div className="detail-grid two-col">
              <div className="detail-card"><span>证据支持分</span><strong>{result.evidenceSummary.evidenceBackedScore}/100</strong></div>
              <div className="detail-card"><span>证据分布</span><strong>{result.evidenceSummary.strong} 强 · {result.evidenceSummary.partial} 部分 · {result.evidenceSummary.missing} 缺失</strong></div>
            </div>
          ) : null}
          {(result.coverage || []).length ? (
            <div className="jd-suggestions">
              <h5>岗位要求与简历证据</h5>
              {(result.coverage || []).map((item, index) => (
                <div className="validation-item" key={`${item.requirement}-${index}`}>
                  <strong>{item.strength === 'strong' ? '强证据' : item.strength === 'partial' ? '部分证据' : '证据缺失'} · {item.requirement}</strong>
                  <p>{item.evidence || item.evidenceReason || '简历中未找到可引用事实。'}</p>
                </div>
              ))}
            </div>
          ) : null}
          <div className="jd-columns">
            <ResultColumn title="已匹配" values={result.matched || []} className="jd-matched" empty="暂无匹配项。" />
            <ResultColumn title="缺口" values={result.gaps || []} className="jd-gap" empty="无明显缺口。" />
          </div>
          <div className="jd-suggestions">
            <h5>简历补强建议</h5>
            <ul>{(result.suggestions || []).map((suggestion, index) => <li key={index}>{suggestion}</li>)}</ul>
          </div>
        </div>
      ) : <p className="empty">粘贴岗位描述并点击对比，这里会展示匹配度、匹配点、缺口与补强建议。</p>}
      <div className="jd-history">
        <h5>历史匹配记录</h5>
        {history.length ? (
          <div className="risk-list">
            {history.map((match) => (
              <div className="risk-item" key={match.id}>
                <strong>{match.job?.title || match.job?.company || '未命名岗位'} · {match.matchScore}/100</strong>
                <p>{match.createdAt}</p>
                <p>{String(match.job?.text || '').slice(0, 100)}...</p>
              </div>
            ))}
          </div>
        ) : <p className="empty">还没有匹配历史。</p>}
      </div>
    </div>
  );
}

function KeywordGroup({ label, values, state }: { label: string; values: string[]; state: 'ok' | 'miss' }) {
  return (
    <div className="jd-keyword-col">
      <span className="jd-keyword-label">{label}</span>
      {values.length
        ? <div className="jd-keyword-tags">{values.map((value, index) => <span key={index} className={`jd-tag ${state}`}>{value}</span>)}</div>
        : <p className="empty">无</p>}
    </div>
  );
}

function ResultColumn({ title, values, className, empty }: { title: string; values: string[]; className: string; empty: string }) {
  return (
    <div className="jd-col">
      <h5>{title}</h5>
      {values.length ? <ul>{values.map((value, index) => <li key={index} className={className}>{value}</li>)}</ul> : <p className="empty">{empty}</p>}
    </div>
  );
}
