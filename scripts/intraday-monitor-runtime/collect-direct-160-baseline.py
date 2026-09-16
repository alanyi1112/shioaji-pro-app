"""收盤後一次性唯讀採集；不登入、不訂閱、不重試、不覆寫。"""
import argparse
import datetime
import hashlib
import json
import os
import pathlib
import shutil
import time
import urllib.request

os.umask(0o077)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--execute', action='store_true', required=True)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--date', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    trade_date = datetime.date.fromisoformat(args.date)
    now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8)))
    if now.date() != trade_date or now.time() < datetime.time(13, 35):
        raise ValueError('只允許當日收盤後採集')
    cohort = json.loads(pathlib.Path(args.manifest).read_text())
    seed = {k: v for k, v in cohort.items() if k != 'manifestHash'}
    digest = hashlib.sha256(json.dumps(seed, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
    if digest != cohort.get('manifestHash') or len({e['canonicalSymbol'] for e in cohort['cohort']}) != 160:
        raise ValueError('cohort hash or uniqueness invalid')
    if cohort['stage'] != 160 or len(cohort['cohort']) != 160:
        raise ValueError('exact 160 cohort required')
    root = pathlib.Path(args.output)
    if not root.is_absolute():
        raise ValueError('absolute output required')
    root.mkdir(parents=True, exist_ok=False, mode=0o700)
    started = time.monotonic()
    ledger = []

    def request(path, body=None):
        if time.monotonic() - started > 1800:
            raise ValueError('total deadline exceeded')
        if shutil.disk_usage(root).free < 8 * 1024**3:
            raise ValueError('disk reserve insufficient')
        time.sleep(1)
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
        info = request('/api/v1/info')
        if info.get('simulation') is not True:
            raise ValueError('simulation required')
        save('source.json', {'version': info['version'], 'simulation': True,
                            'cohortHash': cohort['manifestHash'], 'tradeDate': args.date})
        usage = request('/api/v1/auth/usage')
        save('usage-start.json', usage)
        if usage.get('remaining_bytes', 0) < 256 * 1024**2:
            raise ValueError('provider bandwidth reserve insufficient')
        for index, entry in enumerate(cohort['cohort']):
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
            if (index + 1) % 20 == 0:
                usage = request('/api/v1/auth/usage')
                save(f'usage-{index + 1}.json', usage)
                print(json.dumps({'collected': index + 1, 'remainingBytes': usage.get('remaining_bytes')}), flush=True)
                if usage.get('remaining_bytes', 0) < 128 * 1024**2:
                    raise ValueError('provider bandwidth reserve insufficient')
        save('complete.json', {'collected': 160, 'baselineUsable': False,
                              'reason': 'awaiting_independent_validation'})
    except Exception as error:
        save('failure.json', {'errorType': type(error).__name__, 'baselineUsable': False})
        raise
    finally:
        save('request-ledger.json', ledger)


if __name__ == '__main__':
    main()
