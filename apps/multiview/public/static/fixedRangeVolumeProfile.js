const FIXED_VOLUME_PROFILE_DEFAULT_ROWS = 24;
const FIXED_VOLUME_PROFILE_DEFAULT_VALUE_AREA_PERCENT = 70;

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function computeFixedRangeVolumeProfile(rows, options = {}) {
  const sourceRows = (rows || [])
    .map((row) => ({
      open: finiteNumber(row.open),
      high: finiteNumber(row.high),
      low: finiteNumber(row.low),
      close: finiteNumber(row.close),
      volume: Math.max(0, finiteNumber(row.volume) || 0),
    }))
    .filter((row) => (
      Number.isFinite(row.open)
      && Number.isFinite(row.high)
      && Number.isFinite(row.low)
      && Number.isFinite(row.close)
      && row.high >= row.low
    ));

  if (sourceRows.length < 2) return null;

  const requestedRows = Math.floor(finiteNumber(options.rowCount) || FIXED_VOLUME_PROFILE_DEFAULT_ROWS);
  const requestedValueArea = finiteNumber(options.valueAreaPercent) || FIXED_VOLUME_PROFILE_DEFAULT_VALUE_AREA_PERCENT;
  const rowCount = Math.max(1, Math.min(120, requestedRows));
  const valueAreaPercent = Math.max(1, Math.min(100, requestedValueArea));
  const low = Math.min(...sourceRows.map((row) => row.low));
  const high = Math.max(...sourceRows.map((row) => row.high));
  const totalVolume = sourceRows.reduce((sum, row) => sum + row.volume, 0);

  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  if (high === low) {
    return {
      rowCount: 1,
      valueAreaPercent,
      totalVolume,
      poc: low,
      vah: high,
      val: low,
      buckets: [{
        low,
        high,
        volume: totalVolume,
        buyVolume: sourceRows.reduce((sum, row) => sum + (row.close >= row.open ? row.volume : 0), 0),
        sellVolume: sourceRows.reduce((sum, row) => sum + (row.close < row.open ? row.volume : 0), 0),
        isPoc: true,
        isValueArea: true,
      }],
    };
  }

  const step = (high - low) / rowCount;
  const volumes = Array(rowCount).fill(0);
  const buyVolumes = Array(rowCount).fill(0);
  const sellVolumes = Array(rowCount).fill(0);
  sourceRows.forEach((row) => {
    const typicalPrice = (row.high + row.low + row.close) / 3;
    const rawIndex = Math.floor((typicalPrice - low) / step);
    const index = Math.max(0, Math.min(rowCount - 1, rawIndex));
    volumes[index] += row.volume;
    if (row.close >= row.open) {
      buyVolumes[index] += row.volume;
    } else {
      sellVolumes[index] += row.volume;
    }
  });

  const buckets = volumes.map((volume, index) => ({
    low: low + step * index,
    high: index === rowCount - 1 ? high : low + step * (index + 1),
    volume,
    buyVolume: buyVolumes[index],
    sellVolume: sellVolumes[index],
    isPoc: false,
    isValueArea: false,
  }));

  let pocIndex = 0;
  for (let index = 1; index < volumes.length; index += 1) {
    if (volumes[index] > volumes[pocIndex]) pocIndex = index;
  }

  const targetVolume = totalVolume * (valueAreaPercent / 100);
  let lowerIndex = pocIndex;
  let upperIndex = pocIndex;
  let coveredVolume = volumes[pocIndex];
  while (coveredVolume < targetVolume && (lowerIndex > 0 || upperIndex < rowCount - 1)) {
    const nextLower = lowerIndex > 0 ? volumes[lowerIndex - 1] : -1;
    const nextUpper = upperIndex < rowCount - 1 ? volumes[upperIndex + 1] : -1;
    if (nextUpper >= nextLower) {
      upperIndex += 1;
      coveredVolume += Math.max(0, nextUpper);
    } else {
      lowerIndex -= 1;
      coveredVolume += Math.max(0, nextLower);
    }
  }

  buckets[pocIndex].isPoc = true;
  for (let index = lowerIndex; index <= upperIndex; index += 1) {
    buckets[index].isValueArea = true;
  }

  return {
    rowCount,
    valueAreaPercent,
    totalVolume,
    poc: (buckets[pocIndex].low + buckets[pocIndex].high) / 2,
    vah: buckets[upperIndex].high,
    val: buckets[lowerIndex].low,
    buckets,
  };
}

const api = {
  FIXED_VOLUME_PROFILE_DEFAULT_ROWS,
  FIXED_VOLUME_PROFILE_DEFAULT_VALUE_AREA_PERCENT,
  computeFixedRangeVolumeProfile,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}

if (typeof window !== "undefined") {
  window.QuoteChartFixedRangeVolumeProfile = api;
}
