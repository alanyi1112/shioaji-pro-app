(function initChartAxisFormatting(global) {
  "use strict";

  function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function localizedNumber(value, maximumFractionDigits, options = {}) {
    const number = finiteNumber(value);
    if (number === null) return "--";
    return number.toLocaleString("zh-TW", {
      minimumFractionDigits: 0,
      maximumFractionDigits,
      ...options,
    });
  }

  function formatCompactLotsAxis(value) {
    const number = finiteNumber(value);
    if (number === null) return "--";
    if (Math.abs(number) >= 1000) return `${localizedNumber(number / 1000, 1)}K張`;
    return `${localizedNumber(number, 1)}張`;
  }

  function formatCompactPercentAxis(value, options = {}) {
    const number = finiteNumber(value);
    return number === null ? "--" : `${localizedNumber(number, 2, options)}%`;
  }

  function formatTechnicalOscillatorAxis(value) {
    return localizedNumber(value, 2);
  }

  function formatTechnicalAdaptiveAxis(value) {
    const number = finiteNumber(value);
    if (number === null) return "--";
    const abs = Math.abs(number);
    const maximumFractionDigits = abs > 0 && abs < 10 ? 2 : 0;
    return localizedNumber(number, maximumFractionDigits);
  }

  global.QuoteChartAxisFormatting = {
    formatCompactLotsAxis,
    formatCompactPercentAxis,
    formatTechnicalAdaptiveAxis,
    formatTechnicalOscillatorAxis,
  };
})(window);
