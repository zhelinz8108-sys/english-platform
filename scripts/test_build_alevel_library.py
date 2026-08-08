import importlib.util
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("build-alevel-library.py")
SPEC = importlib.util.spec_from_file_location("build_alevel_library", MODULE_PATH)
assert SPEC and SPEC.loader
BUILD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILD)


class AlevelFilenameTest(unittest.TestCase):
    def test_official_question_metadata(self) -> None:
        value = BUILD.official_parts(Path("9706_s24_qp_42.pdf"))
        self.assertEqual(value["syllabusCode"], "9706")
        self.assertEqual(value["year"], 2024)
        self.assertEqual(value["session"], "may-june")
        self.assertEqual(value["role"], "qp")
        self.assertEqual(value["paper"], 4)
        self.assertEqual(value["variant"], 2)

    def test_session_names_and_mark_scheme(self) -> None:
        february = BUILD.official_parts(Path("9701_m25_qp_12.pdf"))
        october = BUILD.official_parts(Path("9702_w19_ms_33.pdf"))
        self.assertEqual(february["session"], "feb-mar")
        self.assertEqual(october["session"], "oct-nov")
        self.assertEqual(BUILD.ROLE_TYPES[october["role"]], "mark_scheme")

    def test_magic_bytes_override_a_wrong_zip_extension(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "9618_s21_pm_21.zip"
            path.write_bytes(b"%PDF-1.7\nexample")
            self.assertEqual(BUILD.sniff_media_type(path), "application/pdf")

    def test_topical_question_and_answer_are_distinguished(self) -> None:
        question = Path("2021_A2_Complex-Numbers.pdf")
        answer = Path("2021_A2_Complex-Numbers_solved.pdf")
        self.assertEqual(
            BUILD.classify(question, "application/pdf", {})[0], "topic_question"
        )
        self.assertEqual(
            BUILD.classify(answer, "application/pdf", {})[0], "topic_answer"
        )

    def test_syllabus_code_ignores_years_in_legacy_names(self) -> None:
        path = Path("English - 8695") / "2011_2012_8695_question_paper.pdf"
        self.assertEqual(BUILD.infer_syllabus_code(path, {}), "8695")

    def test_directory_code_is_used_when_filename_only_has_a_year(self) -> None:
        path = Path("Information Technology - 9626") / "2022_syllabus.pdf"
        self.assertEqual(BUILD.infer_syllabus_code(path, {}), "9626")


class AlevelPairingTest(unittest.TestCase):
    def item(self, item_id: str, role: str, component: str | None) -> dict:
        return {
            "id": item_id,
            "subjectId": "accounting-9706",
            "syllabusCode": "9706",
            "year": 2024,
            "session": "may-june",
            "component": component,
            "documentType": role,
            "collectionType": "past-paper" if role == "question" else "support",
            "title": item_id,
        }

    def test_question_gets_exact_variant_and_session_wide_resources(self) -> None:
        question = self.item("question", "question", "42")
        exact = self.item("mark-scheme", "mark_scheme", "42")
        wrong = self.item("wrong-variant", "mark_scheme", "41")
        threshold = self.item("threshold", "grade_threshold", None)
        values = [question, exact, wrong, threshold]
        BUILD.pair_resources(values)
        self.assertEqual(question["relatedResourceIds"], ["mark-scheme", "threshold"])


class AlevelInteractionTest(unittest.TestCase):
    def test_multiple_choice_cover_is_detected_without_parsing_question_layout(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "9706_m25_qp_12.pdf"
            document = BUILD.fitz.open()
            page = document.new_page()
            page.insert_text(
                (72, 72),
                "Paper 1 Multiple Choice\nThere are thirty questions on this paper.\n"
                "For each question there are four possible answers A, B, C and D.",
            )
            document.save(path)
            document.close()
            self.assertEqual(
                BUILD.inspect_multiple_choice(path),
                {
                    "kind": "multiple-choice",
                    "questionCount": 30,
                    "choices": ["A", "B", "C", "D"],
                },
            )

    def test_mark_scheme_answer_table_becomes_answer_key(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "9706_m25_ms_12.pdf"
            document = BUILD.fitz.open()
            page = document.new_page()
            page.insert_text((72, 72), "Question\nAnswer\nMarks\n1\nA\n1\n2\nC\n1\n3\nD\n1")
            document.save(path)
            document.close()
            self.assertEqual(BUILD.extract_answer_key(path, 3), {"1": "A", "2": "C", "3": "D"})


if __name__ == "__main__":
    unittest.main()
