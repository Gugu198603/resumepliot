export function getAppRoadmap() {
  return {
    done: [
      'skill-driven 多 agent 链路（planner/retriever/interviewer/critic/writer/jdMatcher）',
      '真实语义检索（BGE-M3 embedding）+ Qdrant 向量库可切换',
      'SQLite + Prisma 持久化，历史运行与会话可回看',
      '多岗位 JD 对比并落库，匹配结果可回看',
      '招聘岗位抓取：Greenhouse / Lever 公开 ATS 适配器 + 定时调度器去重入库'
    ],
    phase1: [
      '支持多份简历并行管理与对比',
      '模拟面试会话状态打磨与连续追问体验',
      '岗位抓取扩展更多数据源与地域/关键词过滤'
    ],
    phase2: [
      '增加登录、作品集、分享链接',
      '个性化投递建议与岗位-简历差距报告',
      'LLM 成本与延迟看板（已采集 trace，待做聚合视图）'
    ],
    phase3: [
      '语音面试模式',
      '桌面 / Web App 打包分发'
    ]
  };
}
