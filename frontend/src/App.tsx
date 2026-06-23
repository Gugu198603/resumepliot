import { useMemo, useState } from 'react';

type Section = { title: string; content: string[] };
type Risk = { term: string; reason: string };
type Retrieved = { id: number; content: string; score: number };

type ParseResult = {
  text: string;
  sections: Section[];
  risks: Risk[];
  kbSize: number;
};

export default function App() {
  const [resumeText, setResumeText] = useState('');
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [query, setQuery] = useState('帮我针对字节实习生成面试追问');
  const [retrieved, setRetrieved] = useState<Retrieved[]>([]);
  const [questionGroups, setQuestionGroups] = useState<Record<string, string[]>>({});
  const [answer, setAnswer] = useState('');
  const [evaluation, setEvaluation] = useState<any>(null);
  const [rewrite, setRewrite] = useState<{ concise: string; detailed: string } | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  const stats = useMemo(() => {
    if (!parseResult) return null;
    return [
      ['分块数量', String(parseResult.kbSize)],
      ['风险术语', String(parseResult.risks.length)],
      ['识别模块', String(parseResult.sections.length)]
    ];
  }, [parseResult]);

  async function parseResume(file?: File) {
    setLoading('正在解析简历...');
    const form = new FormData();
    if (file) form.append('resume', file);
    if (resumeText.trim()) form.append('text', resumeText);
    const res = await fetch('/api/parse', { method: 'POST', body: form });
    const data = await res.json();
    setParseResult(data);
    setResumeText(data.text);
    setLoading(null);
  }

  async function generateQuestions() {
    if (!resumeText.trim()) return;
    setLoading('正在生成追问...');
    const res = await fetch('/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: resumeText, query })
    });
    const data = await res.json();
    setRetrieved(data.retrieved);
    setQuestionGroups(data.questions);
    setLoading(null);
  }

  async function evaluateAnswer() {
    setLoading('正在评估回答...');
    const res = await fetch('/api/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer, retrieved })
    });
    setEvaluation(await res.json());
    setLoading(null);
  }

  async function rewriteResume() {
    setLoading('正在改写简历...');
    const res = await fetch('/api/rewrite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: resumeText })
    });
    setRewrite(await res.json());
    setLoading(null);
  }

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">ResumePilot</p>
          <h1>AI 简历拆解 + RAG 检索 + 面试 Agent 原型</h1>
          <p className="subtitle">
            这个版本故意把“RAG / 向量检索 / Agent 风格追问”做成可读代码，方便你 1 小时后自己继续拆。
          </p>
        </div>
        {stats && (
          <div className="stats">
            {stats.map(([label, value]) => (
              <div key={label} className="stat-card">
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        )}
      </header>

      <main className="grid">
        <section className="card tall">
          <h2>1. 导入简历</h2>
          <textarea
            value={resumeText}
            onChange={(e) => setResumeText(e.target.value)}
            placeholder="粘贴你的简历文本，或者上传 PDF。"
          />
          <div className="row">
            <label className="upload">
              上传 PDF / TXT
              <input
                type="file"
                accept=".pdf,.txt"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) parseResume(file);
                }}
              />
            </label>
            <button onClick={() => parseResume()}>解析文本</button>
          </div>
          {parseResult && (
            <div className="section-list">
              {parseResult.sections.map((section) => (
                <div key={section.title} className="section-item">
                  <h3>{section.title}</h3>
                  <ul>
                    {section.content.slice(0, 4).map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <h2>2. 风险术语扫描</h2>
          <div className="risk-list">
            {parseResult?.risks?.length ? (
              parseResult.risks.map((risk) => (
                <div className="risk-item" key={risk.term}>
                  <strong>{risk.term}</strong>
                  <p>{risk.reason}</p>
                </div>
              ))
            ) : (
              <p className="empty">解析后会在这里展示高风险术语。</p>
            )}
          </div>
        </section>

        <section className="card">
          <h2>3. RAG 检索与追问生成</h2>
          <input value={query} onChange={(e) => setQuery(e.target.value)} />
          <button onClick={generateQuestions}>生成追问</button>
          <div className="retrieved">
            {retrieved.map((item) => (
              <div key={item.id} className="retrieved-item">
                <span>Chunk #{item.id}</span>
                <span>score {item.score}</span>
                <p>{item.content}</p>
              </div>
            ))}
          </div>
          <div className="question-groups">
            {Object.entries(questionGroups).map(([group, questions]) => (
              <div key={group}>
                <h3>{group}</h3>
                <ul>
                  {questions.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <h2>4. 回答评估 Agent</h2>
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="输入你对某个问题的回答，例如：我在字节主要参与了 Slide SDK 多端适配..."
          />
          <button onClick={evaluateAnswer}>评估回答</button>
          {evaluation && (
            <div className="evaluation">
              <div className="scores">
                {Object.entries(evaluation.scores).map(([key, value]) => (
                  <div key={key} className="score-card">
                    <span>{key}</span>
                    <strong>{String(value)}</strong>
                  </div>
                ))}
              </div>
              <ul>
                {evaluation.feedback.map((item: string) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="card full">
          <h2>5. 双版本改写</h2>
          <button onClick={rewriteResume}>生成精简版 / 详细版</button>
          {rewrite && (
            <div className="rewrite-grid">
              <div>
                <h3>精简版</h3>
                <pre>{rewrite.concise}</pre>
              </div>
              <div>
                <h3>详细版</h3>
                <pre>{rewrite.detailed}</pre>
              </div>
            </div>
          )}
        </section>
      </main>

      {loading && <div className="loading">{loading}</div>}
    </div>
  );
}
