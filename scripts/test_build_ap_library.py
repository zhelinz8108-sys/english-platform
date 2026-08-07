import importlib.util
import gzip
import json
import tempfile
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


class ExpandApYearCollectionTest(unittest.TestCase):
    def document(self, title: str, sha256: str = "a" * 64) -> dict:
        return {
            "id": "source-document",
            "subjectId": "calculus-ab",
            "relativePath": f"folder/{title}.pdf",
            "title": title,
            "year": 1998,
            "sizeBytes": 100,
            "sha256": sha256,
            "mediaType": "application/pdf",
            "originalStorageKey": "original.pdf",
            "nativeStorageKey": "native.json.gz",
            "documentType": "question",
            "answerDocumentIds": [],
            "pageCount": 4,
            "questionCount": 2,
            "textStatus": "native",
        }

    def write_native(self, root: Path, sha256: str, headings: list[str]) -> None:
        (root / "native").mkdir(parents=True)
        payload = {
            "pages": [
                {
                    "number": index,
                    "blocks": [{"text": heading}],
                    "questions": ([{"number": 1}] if "Question" in heading else []),
                }
                for index, heading in enumerate(headings, 1)
            ]
        }
        with gzip.open(root / "native" / f"{sha256}.json.gz", "wt", encoding="utf-8") as stream:
            json.dump(payload, stream)

    def test_long_collection_uses_only_released_years_detected_in_pages(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            document = self.document("AP Calc AB BC 1969-1998年")
            self.write_native(
                root,
                document["sha256"],
                [
                    "1969 AP Calculus Exam Question 1",
                    "1969 Calculus Solutions",
                    "1973 AP Calculus Exam Question 1",
                    "1973 Calculus Solutions",
                ],
            )
            expanded = BUILD_AP_LIBRARY.expand_year_collections([document], root)
            source = next(item for item in expanded if item["id"] == document["id"])
            yearly = [item for item in expanded if item.get("sourceDocumentId") == document["id"]]
            self.assertEqual(source["documentType"], "reference")
            self.assertEqual([item["year"] for item in yearly], [1969, 1973])
            self.assertTrue(all("1969-1998" not in item["title"] for item in yearly))

    def test_short_collection_keeps_scanned_years_without_text(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            document = self.document("AP Physics 2012-2015")
            self.write_native(
                root,
                document["sha256"],
                ["2015 AP Physics Exam Question 1", "scanned page", "2013 AP Physics Exam"],
            )
            details = BUILD_AP_LIBRARY.collection_year_details(document, root, 2012, 2015)
            self.assertEqual(sorted(details), [2012, 2013, 2014, 2015])


if __name__ == "__main__":
    unittest.main()
