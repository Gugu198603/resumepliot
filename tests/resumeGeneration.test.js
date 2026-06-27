import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCareerProfileFromResume } from '../server/services/resumeGeneration.js';

test('buildCareerProfileFromResume splits multiple work entries inside one section', () => {
  const profile = buildCareerProfileFromResume({
    resume: {
      text: '',
      sections: [
        {
          title: '工作经验',
          content: [
            '前端开发实习生易身的(柠檬树)软件公司2024.11-2025.2',
            '数据分析看板：独立开发 ECharts 多维可视化看板。',
            '代码首屏加载时间降低35%。',
            '前端开发实习生广东三维家信息科技有限公司2024.2-2025.5',
            '跨窗口通信设计：基于 postMessage 实现 AI 布局服务多窗口同步。',
            '组件库建设：封装可配置表格组件。',
            '前端开发实习生深圳市字节跳动公司2025.5',
            'SlideSDK 多端迁移改造：参与核心逻辑抽离。'
          ]
        }
      ]
    }
  });

  assert.equal(profile.work.length, 3);
  assert.equal(profile.work[0].name, '易身的(柠檬树)软件公司');
  assert.equal(profile.work[0].position, '前端开发实习生');
  assert.equal(profile.work[0].startDate, '2024.11');
  assert.equal(profile.work[0].endDate, '2025.2');
  assert.deepEqual(profile.work[0].highlights.map((item) => item.text), [
    '数据分析看板：独立开发 ECharts 多维可视化看板。',
    '代码首屏加载时间降低35%。'
  ]);
  assert.equal(profile.work[1].name, '广东三维家信息科技有限公司');
  assert.equal(profile.work[2].name, '深圳市字节跳动公司');
  assert.ok(!profile.work[0].highlights.some((item) => item.text.includes('广东三维家')));
});
