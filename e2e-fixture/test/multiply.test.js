import test from "node:test";
import assert from "node:assert/strict";
import { multiply } from "../src/multiply.js";

test("multiplies positive numbers", () => {
  assert.equal(multiply(2, 3), 6);
});

test("multiplies negative numbers", () => {
  assert.equal(multiply(-2, 3), -6);
  assert.equal(multiply(-2, -3), 6);
});

test("multiplies by zero", () => {
  assert.equal(multiply(5, 0), 0);
  assert.equal(multiply(0, 5), 0);
});
