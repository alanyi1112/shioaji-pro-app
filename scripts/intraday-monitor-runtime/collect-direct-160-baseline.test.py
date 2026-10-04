"""不連線測試採集流量保留規則。"""
import importlib.util
import pathlib
import unittest


MODULE_PATH = pathlib.Path(__file__).with_name('collect-direct-160-baseline.py')
SPEC = importlib.util.spec_from_file_location('collect_direct_160_baseline', MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class BudgetGuardTests(unittest.TestCase):
    def setUp(self):
        self.limit = 524_288_000
        self.budget = {
            'schemaVersion': 'intraday-monitor-baseline-bandwidth-budget/1',
            'tradeDate': '2026-09-23', 'manifestHash': 'a' * 64,
            'ready': True, 'attempt': 2, 'providerLimitBytes': self.limit,
            'providerUsedBytes': self.limit - 227_509_396,
            'providerRemainingBytes': 227_509_396,
            'reserveBytes': 131_072_000, 'forecastBytes': 59_157_063,
            'requiredStartBytes': 190_229_063, 'forecastPerSymbolBytes': 369_732,
            'maxResponseBytes': 16 * 1024**2,
            'samples': [
                {'tradeDate': '2026-09-14', 'manifestHash': 'a' * 64,
                 'providerLimitBytes': self.limit, 'consumedBytes': 17_933_604,
                 'sourceSha256': 'b' * 64, 'usageStartSha256': 'c' * 64,
                 'usageEndSha256': 'd' * 64, 'verificationSha256': 'e' * 64,
                 'baselineSha256': 'f' * 64},
                {'tradeDate': '2026-09-15', 'manifestHash': 'a' * 64,
                 'providerLimitBytes': self.limit, 'consumedBytes': 19_719_021,
                 'sourceSha256': 'b' * 64, 'usageStartSha256': 'c' * 64,
                 'usageEndSha256': 'd' * 64, 'verificationSha256': 'e' * 64,
                 'baselineSha256': 'f' * 64},
            ],
        }

    def usage(self, remaining):
        return {'limit_bytes': self.limit, 'bytes': self.limit - remaining,
                'remaining_bytes': remaining}

    def test_valid_plan_and_per_request_guard(self):
        MODULE.validate_budget(self.budget, '2026-09-23', 'a' * 64)
        self.assertEqual(MODULE.ensure_budget_capacity(self.budget, 160,
            lambda: self.usage(227_509_396)), 227_509_396)
        self.assertEqual(MODULE.required_remaining(self.budget, 160), 190_229_120)

    def test_quota_drop_stops_before_next_data_request(self):
        with self.assertRaisesRegex(ValueError,
                'provider_bandwidth_budget_insufficient_during_capture'):
            MODULE.ensure_budget_capacity(self.budget, 120,
                lambda: self.usage(150_000_000))

    def test_quota_identity_and_sample_corruption_fail_closed(self):
        with self.assertRaisesRegex(ValueError, 'provider usage identity invalid'):
            MODULE.ensure_budget_capacity(self.budget, 80,
                lambda: {'limit_bytes': self.limit, 'bytes': 5,
                         'remaining_bytes': self.limit})
        self.budget['samples'] = [None, self.budget['samples'][1]]
        with self.assertRaisesRegex(ValueError, 'baseline budget samples invalid'):
            MODULE.validate_budget(self.budget, '2026-09-23', 'a' * 64)


if __name__ == '__main__':
    unittest.main()
