import re
import unittest
from pathlib import Path

from czi_pipeline.batch import canonical_sample_key, sample_id_for_key


class SampleIdTests(unittest.TestCase):
    def test_id_is_stable_and_accepted_by_petro_image(self):
        sample_id = sample_id_for_key("abc-123")
        self.assertEqual(sample_id, sample_id_for_key("abc-123"))
        self.assertRegex(sample_id, re.compile(r"^[0-9a-hjkmnp-tv-z]{8}$"))

    def test_filename_normalization_is_case_insensitive(self):
        first = canonical_sample_key(Path(" ABC-123.czi"))
        second = canonical_sample_key(Path("abc-123.CZI"))
        self.assertEqual(first, second)
        self.assertEqual(sample_id_for_key(first), sample_id_for_key(second))

    def test_different_names_produce_different_fixture_ids(self):
        self.assertNotEqual(
            sample_id_for_key("abc-123"),
            sample_id_for_key("abc-124"),
        )


if __name__ == "__main__":
    unittest.main()
