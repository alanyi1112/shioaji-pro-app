#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "gateway-install: fail reason=root_required" >&2
  exit 1
fi

release_id=${1:-}
if [[ ! ${release_id} =~ ^[0-9a-f]{7,64}$ ]]; then
  echo "gateway-install: fail reason=invalid_release_id" >&2
  exit 1
fi

script_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
gateway_source=$(cd -- "${script_directory}/.." && pwd -P)
release_root=/opt/multichart-gateway/releases
release_directory=${release_root}/${release_id}
current_link=/opt/multichart-gateway/current
unit_source=${gateway_source}/deploy/multichart-gateway.service
unit_target=/etc/systemd/system/multichart-gateway.service
credential_store=/etc/credstore.encrypted/multichart-gateway

for required_path in \
  "${gateway_source}/pyproject.toml" \
  "${gateway_source}/uv.lock" \
  "${gateway_source}/.venv/bin/python" \
  "${unit_source}"
do
  if [[ ! -e ${required_path} ]]; then
    echo "gateway-install: fail reason=staging_incomplete" >&2
    exit 1
  fi
done

if [[ -e ${release_directory} ]]; then
  echo "gateway-install: fail reason=release_exists" >&2
  exit 1
fi

if ! getent group multichart-gateway >/dev/null; then
  groupadd --system multichart-gateway
fi
if ! id --user multichart-gateway >/dev/null 2>&1; then
  useradd \
    --system \
    --gid multichart-gateway \
    --home-dir /var/lib/multichart-gateway \
    --shell /usr/sbin/nologin \
    --no-create-home \
    multichart-gateway
fi

install -d -o root -g root -m 0755 /opt/multichart-gateway "${release_root}"
install -d -o root -g root -m 0700 "${credential_store}"
install -d -o root -g root -m 0755 "${release_directory}"
cp -a -- "${gateway_source}/." "${release_directory}/"
chown -R root:root "${release_directory}"
chmod -R a+rX,go-w "${release_directory}"

ln -sfn -- "${release_directory}" "${current_link}"
install -o root -g root -m 0644 "${unit_source}" "${unit_target}"

"${current_link}/.venv/bin/python" -c 'import multichart_gateway, shioaji'
systemctl daemon-reload
systemd-analyze verify --man=no "${unit_target}"

echo "gateway-install: pass state=installed_not_enabled"
