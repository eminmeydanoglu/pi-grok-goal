import test from "node:test";
import assert from "node:assert/strict";
import { sum } from "../src/sum.js";

test("sums positive numbers", () => assert.equal(sum(2, 3), 5));
test("sums negative numbers", () => assert.equal(sum(-2, -3), -5));
