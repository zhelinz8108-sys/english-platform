import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("build-ap-library.py")
SPEC = importlib.util.spec_from_file_location("build_ap_library", MODULE_PATH)
assert SPEC and SPEC.loader
BUILD_AP_LIBRARY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILD_AP_LIBRARY)


class ClassifyApDocumentTest(unittest.TestCase):
    def assert_role(self, relative_path: str, expected: str) -> None:
        self.assertEqual(BUILD_AP_LIBRARY.classify(Path(relative_path)), expected)

    def test_question_files_do_not_inherit_answer_roles_from_folders(self) -> None:
        self.assert_role("微积分/简答题/2024/qp-2024-calculus-ab.pdf", "question")
        self.assert_role("微积分/Scoring/2024/ap24-frq-calculus-ab.pdf", "question")
        self.assert_role("艺术史/带答案/2001/arthistory_01.pdf", "question")

    def test_answer_and_commentary_files_remain_answers(self) -> None:
        self.assert_role("微积分/简答题/2024/sg-2024-calculus-ab.pdf", "answer")
        self.assert_role("艺术史/2024/ap24-apc-art-history-q1.pdf", "answer")
        self.assert_role("语言/2020/frq1-scoring-commentaries-2020-rubrics.pdf", "answer")

    def test_combined_and_no_answer_titles_are_distinguished(self) -> None:
        self.assert_role("2025 AP微积分AB 选择题+简答题+答案.pdf", "combined")
        self.assert_role("AP Calc AB 2003(没答案).pdf", "question")

    def test_reference_and_parent_fallbacks(self) -> None:
        self.assert_role("欧洲历史/2024/关于棕榈大道本科申请.pdf", "reference")
        self.assert_role("微积分/答案/scan.pdf", "answer")


if __name__ == "__main__":
    unittest.main()
