#!/bin/zsh

set -eu

SCRIPT_PATH="${0:A}"
REPO_DIR="${SCRIPT_PATH:h}"
RUNTIME="${REPO_DIR}/scripts/realtimestock-runtime"

cd "${REPO_DIR}"

if [[ ! -x "${RUNTIME}" ]]; then
    print -u2 "找不到可執行的 runtime：${RUNTIME}"
    print -u2 '請確認 RealTimeStock 專案資料夾仍完整存在。'
    exit 1
fi

print '正在檢查 RealTimeStock simulation 執行環境……'
status_output="$(${RUNTIME} status)"

has_status() {
    print -r -- "${status_output}" | grep -qxF -- "$1"
}

if has_status 'runtime_mode=simulation' \
    && has_status 'simulation_job=loaded' \
    && has_status 'business_watchdog_job=loaded' \
    && has_status 'production_readonly_job=stopped' \
    && has_status 'web_job=loaded' \
    && has_status 'multiview_job=loaded' \
    && has_status 'multiview_daily_pipeline_job=loaded' \
    && has_status 'multiview_tdcc_pipeline_job=loaded' \
    && has_status 'api_listener=up' \
    && has_status 'api_simulation=true' \
    && has_status 'api_health=healthy' \
    && has_status 'api_business_session=available' \
    && has_status 'web_listener=up' \
    && has_status 'multiview_listener=up'; then
    print 'RealTimeStock 已正常運作，不重啟也不中斷既有行情連線。'
    print -r -- "${status_output}"
else
    print '必要服務尚未全部就緒，正在安全啟動 simulation……'
    "${RUNTIME}" simulation
fi

print
print '交易終端：http://127.0.0.1:5173'
print 'MultiView：http://127.0.0.1:5174'
print '已保持 production／真實交易模式關閉。'
