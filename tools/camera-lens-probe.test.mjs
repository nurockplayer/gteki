// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: GTEki contributors
import vm from "node:vm";
import { expect, it } from "vitest";
import { LENS_PROBE } from "../tests/e2e/lib/camera.ts";

it("reads the overview lens when its program reuses a cached projection uniform (#811)", () => {
  class GL {
    getUniformLocation() { return {}; }
    useProgram() {}
    uniformMatrix4fv() {}
  }
  const context = vm.createContext({
    WebGL2RenderingContext: GL,
    performance,
    document: { querySelector: () => ({ clientWidth: 412, clientHeight: 915 }) },
  });
  vm.runInContext(`window = self = globalThis; ${LENS_PROBE}`, context);
  const gl = new GL();
  const overview = {}, follow = {};
  const projection = (fov) => {
    const f = 1 / Math.tan(fov * Math.PI / 360);
    return [f / (412 / 915), 0, 0, 0, 0, f, 0, 0, 0, 0, -1, -1, 0, 0, -0.2, 0];
  };
  const overviewLocation = gl.getUniformLocation(overview, "projectionMatrix");
  const followLocation = gl.getUniformLocation(follow, "projectionMatrix");
  const overviewView = gl.getUniformLocation(overview, "viewMatrix");
  const followView = gl.getUniformLocation(follow, "viewMatrix");
  const view = (x) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, 0, 0, 1];
  gl.useProgram(overview);
  gl.uniformMatrix4fv(overviewLocation, false, projection(60));
  gl.uniformMatrix4fv(overviewView, false, view(1));
  expect(context.__qaLensRead(null, 0).fovV).toBeCloseTo(60, 2);
  gl.useProgram(follow);
  gl.uniformMatrix4fv(followLocation, false, projection(50));
  gl.uniformMatrix4fv(followView, false, view(2));
  expect(context.__qaLensRead(null, 0).fovV).toBeCloseTo(50, 2);
  // Three.js skips this upload: the overview program already has its 60-degree uniform.
  gl.useProgram(overview);
  expect(context.__qaLensRead(null, 0).fovV).toBeCloseTo(60, 2);
  expect(context.__qaLensRead(null, 0).cam[0]).toBe(1);
});
