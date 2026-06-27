export function getAppRoadmap() {
  return {
    done: [
      'skill-driven 多 agent 链路（planner/retriever/interviewer/critic/writer/jdMatcher）',
      '真实语义检索（BGE-M3 embedding）+ Qdrant 向量库可切换',
      'SQLite + Prisma 持久化，历史运行与会话可回看',
      '多岗位 JD 对比并落库，匹配结果可回看',
      '招聘岗位抓取：Greenhouse / Lever 公开 ATS 适配器 + 定时调度器去重入库',
      '岗位抓取支持关键词（any/all）/ 排除词 / 地域过滤',
      'LLM 成本与延迟聚合看板（按 model / agent 统计 tokens、成本、延迟、错误率）',
      '岗位-简历差距报告（差距总结 + 命中/缺失关键词，可从已抓取岗位库直接选岗）',
      '多份简历并行管理与对比（多选/重命名/删除 + 基础指标/关键词差异/风险术语/岗位匹配分并排对比）',
      '模拟面试连续追问（背景澄清→方案细节→验证与结果→反思与拓展四段递进，引用上轮回答去重深挖）'
    ],
    phase1: [
      '增加登录、作品集、分享链接',
      '岗位抓取扩展更多数据源（LinkedIn / 自建爬虫）',
      '简历改写版本对比与一键导出'
    ],
    phase2: [
      '面试评分体系与可量化反馈报告',
      '面试题库个性化推荐'
    ],
    phase3: [
      '语音面试模式',
      '桌面 / Web App 打包分发'
    ]
  };
}
