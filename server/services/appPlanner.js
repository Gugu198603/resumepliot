export function getAppRoadmap() {
  return {
    phase1: [
      '完成 skill-driven agent execution',
      '接入真实向量数据库（Qdrant 或 pgvector）',
      '增加用户历史记录与结果回看'
    ],
    phase2: [
      '支持多份简历、多岗位 JD 对比',
      '支持模拟面试会话状态与连续追问',
      '增加登录、作品集、分享链接'
    ],
    phase3: [
      '做成桌面 / Web App',
      '增加语音面试模式',
      '引入招聘岗位抓取与个性化投递建议'
    ]
  };
}
