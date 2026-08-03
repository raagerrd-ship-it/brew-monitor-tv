import unittest
import tempfile
from pathlib import Path

from calibration import CalibrationError, CalibrationStore, Point, solve


class TestSolve(unittest.TestCase):
    def test_two_point(self):
        low = Point(raw=0.4, ref=0.0, captured_at=0)
        high = Point(raw=40.2, ref=40.0, captured_at=0)
        gain, offset = solve(low, high)
        self.assertAlmostEqual(gain, 40.0 / 39.8, places=6)
        self.assertAlmostEqual(0.4 * gain + offset, 0.0, places=9)
        self.assertAlmostEqual(40.2 * gain + offset, 40.0, places=9)

    def test_single_point_is_pure_offset(self):
        gain, offset = solve(Point(raw=0.4, ref=0.0, captured_at=0), None)
        self.assertEqual(gain, 1.0)
        self.assertAlmostEqual(offset, -0.4)

    def test_no_points_is_identity(self):
        self.assertEqual(solve(None, None), (1.0, 0.0))

    def test_points_too_close_rejected(self):
        with self.assertRaises(CalibrationError):
            solve(Point(raw=20.0, ref=20.0, captured_at=0), Point(raw=22.0, ref=22.0, captured_at=0))

    def test_unreasonable_gain_rejected(self):
        with self.assertRaises(CalibrationError):
            solve(Point(raw=0.0, ref=0.0, captured_at=0), Point(raw=40.0, ref=60.0, captured_at=0))

    def test_unreasonable_offset_rejected(self):
        with self.assertRaises(CalibrationError):
            solve(Point(raw=0.0, ref=9.0, captured_at=0), None)


class TestStore(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = Path(self.dir.name) / "calibration.json"

    def tearDown(self):
        self.dir.cleanup()

    def test_capture_persists_and_applies(self):
        store = CalibrationStore(self.path)
        store.capture("tank1", "low", raw=0.4, ref=0.0)
        store.capture("tank1", "high", raw=40.2, ref=40.0)
        self.assertAlmostEqual(store.apply("tank1", 0.4), 0.0, places=9)

        reopened = CalibrationStore(self.path)
        self.assertAlmostEqual(reopened.apply("tank1", 40.2), 40.0, places=9)

    def test_rejected_capture_leaves_state_untouched(self):
        store = CalibrationStore(self.path)
        with self.assertRaises(CalibrationError):
            store.capture("glycol", "low", raw=0.0, ref=9.0)
        self.assertEqual(store.apply("glycol", 10.0), 10.0)

    def test_reset(self):
        store = CalibrationStore(self.path)
        store.capture("tank2", "low", raw=0.5, ref=0.0)
        store.reset("tank2")
        self.assertEqual(store.apply("tank2", 12.0), 12.0)
        self.assertIsNone(store.get("tank2").low)

    def test_unknown_sensor(self):
        store = CalibrationStore(self.path)
        with self.assertRaises(CalibrationError):
            store.get("tank9")


if __name__ == "__main__":
    unittest.main()