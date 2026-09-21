import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fixtureUrl = new URL("./fixtures/shioaji-volume-mapping-1.json", import.meta.url);
const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));

assert.equal(fixture.schemaVersion, "shioaji-volume-mapping-fixture/1");
assert.equal(fixture.api.version, "1.7.1");
assert.equal(fixture.api.simulation, true);
assert.equal(fixture.contract.canonicalVolumeUnit, "common_lot");
assert.equal(fixture.contract.normalizationRevision, "taiwan-stock-common-lot/1");

const tick = fixture.liveTick;
assert.equal(tick.raw.simtrade, false);
assert.equal(tick.raw.intraday_odd, false);
assert.equal(tick.raw.total_volume, tick.expected.cumulativeVolume);
assert.equal(tick.expected.sourceUnit, "common_lot");
assert.equal(tick.expected.canonicalUnit, "common_lot");
assert.equal(tick.expected.acceptedRegularTrade, true);

const kbars = fixture.historicalMinuteKbars;
assert.equal(kbars.rawSummary.volumeSum, kbars.expected.cumulativeVolumeAtLastReturnedMinute);
assert.equal(kbars.expected.sourceUnit, "common_lot");
assert.equal(kbars.expected.canonicalUnit, "common_lot");
assert.ok(kbars.rawSummary.rowCount < 270, "fixture must preserve missing-minute evidence");

const ticks = fixture.historicalTicksBoundary;
const regular = ticks.lastThree.filter(({ datetime }) => {
  const time = datetime.slice(11);
  return time >= "09:00:00" && time <= "13:30:00";
});
assert.equal(regular.length, ticks.expected.regularSessionRows);
assert.equal(ticks.lastThree.length - regular.length, ticks.expected.excludedOutsideRegularSessionRows);

const daily = fixture.dailyQuoteCrossCheck;
assert.equal(daily.sourceUnit, "share");
assert.equal(daily.rawVolume / 1000, daily.expectedCanonicalCommonLots);
assert.notEqual(
  daily.expectedCanonicalCommonLots,
  kbars.expected.cumulativeVolumeAtLastReturnedMinute,
  "daily all-session volume must not be substituted for regular-session minute baseline",
);

console.log(JSON.stringify({
  ok: true,
  schemaVersion: fixture.schemaVersion,
  liveTickUnit: tick.expected.canonicalUnit,
  kbarUnit: kbars.expected.canonicalUnit,
  dailyQuoteUnit: daily.sourceUnit,
  outsideRegularSessionRowsRejected: ticks.expected.excludedOutsideRegularSessionRows,
}));
