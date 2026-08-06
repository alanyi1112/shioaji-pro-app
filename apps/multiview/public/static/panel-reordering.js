(function initPanelReordering(global) {
  "use strict";

  function uniqueOrder(order) {
    return Array.isArray(order) && new Set(order).size === order.length;
  }

  function sameIdentitySet(left, right) {
    if (!uniqueOrder(left) || !uniqueOrder(right) || left.length !== right.length) return false;
    const expected = new Set(left);
    return right.every((identity) => expected.has(identity));
  }

  function enabledForCount(chartCount, panelCount) {
    return [2, 3, 4, 6, 8].includes(Number(chartCount)) && Number(panelCount) > 1;
  }

  function replacePageSlice(fullOrder, pageIndex, pageSize, visibleOrder) {
    const source = Array.isArray(fullOrder) ? [...fullOrder] : [];
    const size = Math.max(1, Number(pageSize) || 1);
    const safePage = Math.max(0, Number(pageIndex) || 0);
    const start = safePage * size;
    const current = source.slice(start, start + size);
    if (!sameIdentitySet(current, visibleOrder || [])) return null;
    source.splice(start, current.length, ...visibleOrder);
    return source;
  }

  function moveItem(order, fromIndex, toIndex) {
    const next = Array.isArray(order) ? [...order] : [];
    const from = Number(fromIndex);
    const to = Number(toIndex);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= next.length || to >= next.length || from === to) return next;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  }

  function normalizedRect(rect, index) {
    const left = Number(rect?.left) || 0;
    const top = Number(rect?.top) || 0;
    const width = Math.max(0, Number(rect?.width) || Number(rect?.right) - left || 0);
    const height = Math.max(0, Number(rect?.height) || Number(rect?.bottom) - top || 0);
    return {
      index,
      left,
      top,
      right: Number.isFinite(Number(rect?.right)) ? Number(rect.right) : left + width,
      bottom: Number.isFinite(Number(rect?.bottom)) ? Number(rect.bottom) : top + height,
      width,
      height,
      centerX: left + width / 2,
      centerY: top + height / 2,
    };
  }

  function targetIndexFromPoint(rects, clientX, clientY) {
    const x = Number(clientX);
    const y = Number(clientY);
    if (!Array.isArray(rects) || !rects.length || !Number.isFinite(x) || !Number.isFinite(y)) return -1;
    const normalized = rects.map(normalizedRect);
    const containing = normalized.find((rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
    if (containing) return containing.index;
    return normalized.reduce((best, rect) => {
      const distance = Math.hypot(x - rect.centerX, y - rect.centerY);
      return !best || distance < best.distance ? { index: rect.index, distance } : best;
    }, null)?.index ?? -1;
  }

  function rangesOverlap(startA, endA, startB, endB) {
    return Math.min(endA, endB) >= Math.max(startA, startB);
  }

  function keyboardTargetIndex(rects, currentIndex, direction) {
    if (!Array.isArray(rects) || !rects[currentIndex]) return -1;
    const normalized = rects.map(normalizedRect);
    const current = normalized[currentIndex];
    const candidates = normalized.filter((candidate) => {
      if (candidate.index === current.index) return false;
      if (direction === "left") return candidate.centerX < current.centerX && rangesOverlap(candidate.top, candidate.bottom, current.top, current.bottom);
      if (direction === "right") return candidate.centerX > current.centerX && rangesOverlap(candidate.top, candidate.bottom, current.top, current.bottom);
      if (direction === "up") return candidate.centerY < current.centerY;
      if (direction === "down") return candidate.centerY > current.centerY;
      return false;
    });
    if (!candidates.length) return -1;
    const vertical = direction === "up" || direction === "down";
    candidates.sort((left, right) => {
      const leftPrimary = vertical ? Math.abs(left.centerY - current.centerY) : Math.abs(left.centerX - current.centerX);
      const rightPrimary = vertical ? Math.abs(right.centerY - current.centerY) : Math.abs(right.centerX - current.centerX);
      const leftSecondary = vertical ? Math.abs(left.centerX - current.centerX) : Math.abs(left.centerY - current.centerY);
      const rightSecondary = vertical ? Math.abs(right.centerX - current.centerX) : Math.abs(right.centerY - current.centerY);
      return leftPrimary - rightPrimary || leftSecondary - rightSecondary || left.index - right.index;
    });
    return candidates[0].index;
  }

  global.QuoteChartPanelReordering = {
    enabledForCount,
    keyboardTargetIndex,
    moveItem,
    replacePageSlice,
    sameIdentitySet,
    targetIndexFromPoint,
  };
})(window);
