"""收盤後單次唯讀採集；嘗試之間由 runner 分目錄保存。"""
import argparse
import datetime
import hashlib
import json
import math
import os
import pathlib
import re
import shutil
import time
import urllib.request

os.umask(0o077)


def checked_usage(usage, budget):
    limit = usage.get('limit_bytes')
    used = usage.get('bytes')
    remaining = usage.get('remaining_bytes')
    if any(type(value) is not int or value < 0 for value in (limit, used, remaining)) or \
            limit != budget['providerLimitBytes'] or used + remaining != limit:
        raise ValueError('provider usage identity invalid')
    return remaining


def required_remaining(budget, remaining_symbols):
    return budget['reserveBytes'] + max(
        budget['maxResponseBytes'],
        remaining_symbols * budget['forecastPerSymbolBytes'])


def ensure_budget_capacity(budget, remaining_symbols, read_usage):
    remaining = checked_usage(read_usage(), budget)
    if remaining < required_remaining(budget, remaining_symbols):
        raise ValueError('provider_bandwidth_budget_insufficient_during_capture')
    return remaining


def validate_budget(budget, trade_date, manifest_hash):
    if budget.get('schemaVersion') != 'intraday-monitor-baseline-bandwidth-budget/1' or \
            budget.get('tradeDate') != trade_date or budget.get('manifestHash') != manifest_hash or \
            budget.get('ready') is not True or \
            type(budget.get('attempt')) is not int or not 1 <= budget['attempt'] <= 3:
        raise ValueError('baseline budget identity invalid')
    names = ('providerLimitBytes', 'providerUsedBytes', 'providerRemainingBytes',
             'reserveBytes', 'forecastBytes',
             'requiredStartBytes', 'forecastPerSymbolBytes', 'maxResponseBytes')
    if any(type(budget.get(name)) is not int or budget[name] < 0 for name in names) or \
            any(budget[name] <= 0 for name in ('providerLimitBytes', 'reserveBytes',
                                               'forecastBytes', 'requiredStartBytes',
                                               'forecastPerSymbolBytes', 'maxResponseBytes')) or \
            budget['providerUsedBytes'] + budget['providerRemainingBytes'] != budget['providerLimitBytes'] or \
            budget['providerRemainingBytes'] < budget['requiredStartBytes']:
        raise ValueError('baseline budget fields invalid')
    samples = budget.get('samples')
    def valid_sample(sample):
        if not isinstance(sample, dict):
            return False
        try:
            age = (datetime.date.fromisoformat(trade_date) -
                   datetime.date.fromisoformat(sample.get('tradeDate', ''))).days
        except (ValueError, TypeError):
            return False
        hashes = ('sourceSha256', 'usageStartSha256', 'usageEndSha256',
                  'verificationSha256', 'baselineSha256')
        return 1 <= age <= 30 and sample.get('manifestHash') == manifest_hash and \
            sample.get('providerLimitBytes') == budget['providerLimitBytes'] and \
            type(sample.get('consumedBytes')) is int and sample['consumedBytes'] > 0 and \
            all(isinstance(sample.get(name), str) and
                re.fullmatch(r'[0-9a-f]{64}', sample[name]) for name in hashes)
    if not isinstance(samples, list) or len(samples) < 2 or \
            any(not valid_sample(sample) for sample in samples) or \
            len({sample['tradeDate'] for sample in samples}) < 2:
        raise ValueError('baseline budget samples invalid')
    if budget['reserveBytes'] < math.ceil(budget['providerLimitBytes'] * 0.25) or \
            budget['forecastBytes'] < 3 * max(s['consumedBytes'] for s in samples) or \
            budget['forecastPerSymbolBytes'] * 160 < budget['forecastBytes'] or \
            budget['requiredStartBytes'] != budget['reserveBytes'] + budget['forecastBytes'] or \
            budget['maxResponseBytes'] != 16 * 1024**2:
        raise ValueError('baseline budget safety invariant invalid')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--execute', action='store_true', required=True)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--date', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--budget', required=True)
    parser.add_argument('--historical-backfill', action='store_true')
    args = parser.parse_args()
    trade_date = datetime.date.fromisoformat(args.date)
    now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8)))
    if args.historical_backfill:
        age = (now.date() - trade_date).days
        if not 1 <= age <= 30:
            raise ValueError('歷史補建僅允許過去 1 至 30 日')
    elif now.date() != trade_date or now.time() < datetime.time(13, 35):
        raise ValueError('只允許當日收盤後採集')
    cohort = json.loads(pathlib.Path(args.manifest).read_text())
    seed = {k: v for k, v in cohort.items() if k != 'manifestHash'}
    digest = hashlib.sha256(json.dumps(seed, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
    if digest != cohort.get('manifestHash') or len({e['canonicalSymbol'] for e in cohort['cohort']}) != 160:
        raise ValueError('cohort hash or uniqueness invalid')
    if cohort['stage'] != 160 or len(cohort['cohort']) != 160:
        raise ValueError('exact 160 cohort required')
    budget_raw = pathlib.Path(args.budget).read_bytes()
    budget = json.loads(budget_raw)
    budget_sha256 = hashlib.sha256(budget_raw).hexdigest()
    validate_budget(budget, args.date, cohort['manifestHash'])
    root = pathlib.Path(args.output)
    if not root.is_absolute():
        raise ValueError('absolute output required')
    root.mkdir(parents=True, exist_ok=False, mode=0o700)
    started = time.monotonic()
    ledger = []
    remaining_symbols = 160

    def request(path, body=None, guard=True):
        if time.monotonic() - started > 1800:
            raise ValueError('total deadline exceeded')
        if shutil.disk_usage(root).free < 8 * 1024**3:
            raise ValueError('disk reserve insufficient')
        if path != '/api/v1/auth/usage':
            time.sleep(1)
        if guard:
            ensure_budget_capacity(budget, remaining_symbols,
                                   lambda: request('/api/v1/auth/usage', guard=False))
        req = urllib.request.Request('http://127.0.0.1:8080' + path,
            data=None if body is None else json.dumps(body).encode(),
            headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=20) as response:
            raw = response.read(16 * 1024**2 + 1)
            if len(raw) > 16 * 1024**2:
                raise ValueError('response exceeds 16 MiB')
        value = json.loads(raw)
        ledger.append({'path': path, 'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                       'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)})
        return value

    def save(name, value):
        with (root / name).open('x') as f:
            json.dump(value, f, ensure_ascii=False)

    try:
        info = request('/api/v1/info', guard=False)
        if info.get('simulation') is not True:
            raise ValueError('simulation required')
        save('source.json', {'version': info['version'], 'simulation': True,
                            'cohortHash': cohort['manifestHash'], 'tradeDate': args.date,
                            'attempt': budget['attempt'], 'budgetSha256': budget_sha256,
                            'historicalBackfill': args.historical_backfill,
                            'collectedAt': now.isoformat(), 'scheduledRunSuccess': False})
        usage = request('/api/v1/auth/usage', guard=False)
        save('usage-start.json', usage)
        if checked_usage(usage, budget) < budget['requiredStartBytes']:
            raise ValueError('provider_bandwidth_budget_insufficient_at_start')
        for index, entry in enumerate(cohort['cohort']):
            remaining_symbols = 160 - index
            contract = entry['contractIdentity']
            code = contract['code']
            detail = request(f'/api/v1/data/contracts/{code}/info?security_type=STK&region=TW')
            save(f'{code}.contract.json', detail)
            for ordinal in [1, 2]:
                bars = request('/api/v1/data/kbars', {'contract': contract, 'start': args.date, 'end': args.date})
                save(f'{code}.kbars-{ordinal}.json', {'fetchedAt': ledger[-1]['at'], 'data': bars})
            ticks = request('/api/v1/data/ticks', {'contract': contract, 'date': args.date,
                            'query_type': 'RangeTime', 'time_start': '09:00:00', 'time_end': '13:34:00'})
            save(f'{code}.ticks.json', ticks)
            remaining_symbols = 159 - index
            if (index + 1) % 20 == 0:
                usage = request('/api/v1/auth/usage', guard=False)
                save(f'usage-{index + 1}.json', usage)
                print(json.dumps({'collected': index + 1, 'remainingBytes': usage.get('remaining_bytes')}), flush=True)
                if checked_usage(usage, budget) < required_remaining(budget, remaining_symbols):
                    raise ValueError('provider_bandwidth_budget_insufficient_during_capture')
        save('complete.json', {'collected': 160, 'baselineUsable': False,
                              'reason': 'awaiting_independent_validation'})
    except Exception as error:
        safe_reason = str(error) if str(error) in {
            'provider_bandwidth_budget_insufficient_at_start',
            'provider_bandwidth_budget_insufficient_during_capture',
            'provider usage identity invalid',
        } else 'baseline_collect_failed'
        save('failure.json', {'errorType': type(error).__name__,
                              'reason': safe_reason, 'baselineUsable': False})
        raise
    finally:
        save('request-ledger.json', ledger)


if __name__ == '__main__':
    main()
