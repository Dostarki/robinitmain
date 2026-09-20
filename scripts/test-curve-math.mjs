import assert from "node:assert/strict";
import { CURVE_SUPPLY, CURVE_TARGET, PRICE_END, PRICE_START, marginalPrice, quoteCurve, revenueAt, soldAtRevenue } from "../app/web/src/lib/curve-math.mjs";

const closeTo = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);

closeTo(revenueAt(0), 0);
closeTo(revenueAt(50_000_000), 10_000);
closeTo(revenueAt(100_000_000), 30_000);
closeTo(revenueAt(CURVE_SUPPLY), CURVE_TARGET);
closeTo(soldAtRevenue(10_000), 50_000_000, 0.001);
closeTo(soldAtRevenue(30_000), 100_000_000, 0.001);
closeTo(marginalPrice(0), PRICE_START);
closeTo(marginalPrice(CURVE_SUPPLY), PRICE_END);

const opening = quoteCurve(0, 100);
assert.ok(opening.tokens > 0);
assert.ok(opening.averagePrice >= PRICE_START);
assert.ok(opening.nextPrice > PRICE_START);

const capped = quoteCurve(99_950, 1_000);
closeTo(capped.acceptedUsd, 50);
closeTo(capped.raisedAfterUsd, CURVE_TARGET);
closeTo(capped.remainingTokens, 0, 0.001);

const exhausted = quoteCurve(CURVE_TARGET, 100);
closeTo(exhausted.tokens, 0);
closeTo(exhausted.acceptedUsd, 0);

console.log("Curve math checks passed.");
