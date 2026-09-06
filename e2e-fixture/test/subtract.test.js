import test from "node:test";
import assert from "node:assert/strict";
import { subtract } from "../src/subtract.js";

test("subtracts positive integers", () => {
  assert.equal(subtract(8, 3), 5);
});

test("subtracts negative integers", () => {
  assert.equal(subtract(-2, -5), 3);
  assert.equal(subtract(-5, -2), -3);
});
