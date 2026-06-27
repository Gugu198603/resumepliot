import tempfile
import unittest
from pathlib import Path

from resume_generation_skill import FactValidator, ResumeGenerationSkill, career_profile_to_json_resume


def sample_profile():
    return {
        "evidence": [
            {
                "id": "resume-1",
                "kind": "original_resume",
                "text": """
                张三 Frontend Engineer zhangsan@example.com 13800000000 上海
                ExampleTech 前端工程师 2022-03 至 2025-06
                使用 React 和 TypeScript 建设 ResumePilot，首屏加载耗时降低 47.3%
                ResumePilot 项目 使用 React TypeScript Vite
                复旦大学 软件工程 本科 2018-09 2022-06
                """,
            },
            {
                "id": "chat-1",
                "kind": "conversation_confirmation",
                "confirmed": True,
                "text": "用户确认目标岗位是高级前端工程师。",
            },
        ],
        "basics": {
            "name": "张三",
            "label": "高级前端工程师",
            "email": "zhangsan@example.com",
            "phone": "13800000000",
            "location": {"city": "上海"},
            "source_ids": ["resume-1", "chat-1"],
        },
        "work": [
            {
                "company": "ExampleTech",
                "position": "前端工程师",
                "startDate": "2022/03",
                "endDate": "2025/06",
                "highlights": [
                    {
                        "text": "使用 React 和 TypeScript 建设 ResumePilot，首屏加载耗时降低 47.3%",
                        "source_ids": ["resume-1"],
                    }
                ],
                "source_ids": ["resume-1"],
            }
        ],
        "projects": [
            {
                "name": "ResumePilot",
                "description": "ResumePilot 项目",
                "technologies": ["React", "TypeScript", "Vite"],
                "source_ids": ["resume-1"],
            }
        ],
        "education": [
            {
                "institution": "复旦大学",
                "area": "软件工程",
                "studyType": "本科",
                "startDate": "2018-09",
                "endDate": "2022-06",
                "source_ids": ["resume-1"],
            }
        ],
        "metadata": {"targetRole": "高级前端工程师"},
    }


class ResumeGenerationSkillTest(unittest.TestCase):
    def test_career_profile_to_json_resume(self):
        resume = career_profile_to_json_resume(sample_profile())

        self.assertEqual(resume["basics"]["name"], "张三")
        self.assertEqual(resume["basics"]["label"], "高级前端工程师")
        self.assertEqual(resume["work"][0]["name"], "ExampleTech")
        self.assertEqual(resume["work"][0]["startDate"], "2022-03")
        self.assertIn("47.3%", resume["work"][0]["highlights"][0])
        self.assertEqual(resume["projects"][0]["keywords"], ["React", "TypeScript", "Vite"])

    def test_validator_blocks_unsupported_fact(self):
        profile = sample_profile()
        resume = career_profile_to_json_resume(profile)
        resume["work"][0]["highlights"].append("主导 20 人团队完成 300% 增长")

        report = FactValidator.from_profile(profile).validate_json_resume(resume)

        self.assertFalse(report.ok)
        self.assertEqual(report.issues[0].code, "UNSUPPORTED_FACT")
        self.assertIn("20 人", report.issues[0].unsupported_tokens)
        self.assertIn("300%", report.issues[0].unsupported_tokens)

    def test_generator_writes_only_when_valid(self):
        profile = sample_profile()
        with tempfile.TemporaryDirectory() as tmpdir:
            output = Path(tmpdir) / "resume.json"
            result = ResumeGenerationSkill().generate_resume_json(profile, str(output))

            self.assertTrue(result.ok)
            self.assertTrue(output.exists())
            self.assertEqual(result.resume["meta"]["source"], "ResumePilot")


if __name__ == "__main__":
    unittest.main()
