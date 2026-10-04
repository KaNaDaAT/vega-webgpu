(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports, require('vega-scenegraph')) :
    typeof define === 'function' && define.amd ? define(['exports', 'vega-scenegraph'], factory) :
    (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.vegaWebGPURenderer = {}, global.vega));
})(this, (function (exports, vegaScenegraph) { 'use strict';

    /** Marks whose canvas draw translates to each item and back by the negated offset. */
    const PER_ITEM = new Set(['arc', 'shape', 'symbol', 'path']);
    /** vega's own draw order: no zindex keeps the list, otherwise those come last. */
    function ordered(items) {
        if (!items.some(item => item.zindex)) {
            return items;
        }
        const plain = items.filter(item => !item.zindex);
        const zed = items
            .map((item, index) => ({ item, index }))
            .filter(entry => entry.item.zindex)
            .sort((a, b) => a.item.zindex - b.item.zindex || a.index - b.index)
            .map(entry => entry.item);
        return [...plain, ...zed];
    }
    /**
     * The translation canvas's rasterizer actually holds when each text mark draws,
     * against the one it reports, in device pixels.
     *
     * Chrome keeps a canvas matrix in float32 and reports it back as a double, and
     * vega's canvas renderer translates to every arc, shape, symbol and path item
     * and back again by the negated offset. Those cancel on paper and not in
     * float32, so the matrix drifts further from the reported one with every item
     * drawn: about 2.7e-4 of a pixel over the 2260 symbols of the `label` spec.
     *
     * That is nothing anywhere except across a tie. Canvas rounds a text baseline
     * to a whole device pixel and rounds an exact half up, so a baseline landing on
     * .5 goes up undrifted and down drifted, and the label moves a whole row. Four
     * labels in `label` sit on exactly .5 and all four are a row out.
     *
     * Walking the scene the way that renderer does and accumulating the same
     * float32 translation reproduces the number exactly: 10.999725341796875 where
     * the reported matrix says 11, which is what puts The Godfather on row 14
     * rather than 15.
     *
     * Returns null when the scene holds something this does not model, which today
     * is a rotated item: vega rotates and unrotates around those, and that perturbs
     * the whole matrix rather than its translation. Placing text exactly is a
     * better answer than placing it by a drift we got wrong.
     */
    function canvasTextDrift(root, origin, ratio) {
        const out = new Map();
        const scale = Math.fround(ratio);
        let fy = Math.fround(origin[1] * ratio);
        let modelled = true;
        const move = (y) => {
            fy = Math.fround(fy + Math.fround(Math.fround(y) * scale));
        };
        const walk = (mark) => {
            if (!modelled) {
                return;
            }
            const items = (mark.items ?? []);
            if (items.length === 0) {
                return;
            }
            // A clipped mark is drawn inside save and restore, so whatever its items
            // leave in the matrix is popped again with the clip.
            if (mark.clip) {
                const held = fy;
                walkMark(mark, items);
                fy = held;
                return;
            }
            walkMark(mark, items);
        };
        const walkMark = (mark, items) => {
            if (mark.marktype === 'text') {
                out.set(mark, fy);
                return;
            }
            if (mark.marktype === 'group') {
                for (const group of ordered(items)) {
                    const held = fy;
                    move(group.y || 0);
                    for (const child of ordered(group.items ?? [])) {
                        walk(child);
                    }
                    // a group is drawn inside save and restore, so its own offset cancels
                    fy = held;
                }
                return;
            }
            if (!PER_ITEM.has(mark.marktype)) {
                return;
            }
            for (const item of ordered(items)) {
                // vega returns before the translate on a transparent item, so it leaves
                // nothing behind
                if (item.opacity === 0) {
                    continue;
                }
                if (item.angle) {
                    modelled = false;
                    return;
                }
                const y = item.y || 0;
                move(y);
                move(-y);
            }
        };
        walk(root);
        return modelled ? out : null;
    }

    function constant(x) {
      return function constant() {
        return x;
      };
    }

    const abs = Math.abs;
    const atan2 = Math.atan2;
    const cos = Math.cos;
    const max = Math.max;
    const min = Math.min;
    const sin = Math.sin;
    const sqrt = Math.sqrt;

    const epsilon$1 = 1e-12;
    const pi$1 = Math.PI;
    const halfPi = pi$1 / 2;
    const tau$1 = 2 * pi$1;

    function acos(x) {
      return x > 1 ? 0 : x < -1 ? pi$1 : Math.acos(x);
    }

    function asin(x) {
      return x >= 1 ? halfPi : x <= -1 ? -halfPi : Math.asin(x);
    }

    const pi = Math.PI,
        tau = 2 * pi,
        epsilon = 1e-6,
        tauEpsilon = tau - epsilon;

    function append(strings) {
      this._ += strings[0];
      for (let i = 1, n = strings.length; i < n; ++i) {
        this._ += arguments[i] + strings[i];
      }
    }

    function appendRound(digits) {
      let d = Math.floor(digits);
      if (!(d >= 0)) throw new Error(`invalid digits: ${digits}`);
      if (d > 15) return append;
      const k = 10 ** d;
      return function(strings) {
        this._ += strings[0];
        for (let i = 1, n = strings.length; i < n; ++i) {
          this._ += Math.round(arguments[i] * k) / k + strings[i];
        }
      };
    }

    class Path {
      constructor(digits) {
        this._x0 = this._y0 = // start of current subpath
        this._x1 = this._y1 = null; // end of current subpath
        this._ = "";
        this._append = digits == null ? append : appendRound(digits);
      }
      moveTo(x, y) {
        this._append`M${this._x0 = this._x1 = +x},${this._y0 = this._y1 = +y}`;
      }
      closePath() {
        if (this._x1 !== null) {
          this._x1 = this._x0, this._y1 = this._y0;
          this._append`Z`;
        }
      }
      lineTo(x, y) {
        this._append`L${this._x1 = +x},${this._y1 = +y}`;
      }
      quadraticCurveTo(x1, y1, x, y) {
        this._append`Q${+x1},${+y1},${this._x1 = +x},${this._y1 = +y}`;
      }
      bezierCurveTo(x1, y1, x2, y2, x, y) {
        this._append`C${+x1},${+y1},${+x2},${+y2},${this._x1 = +x},${this._y1 = +y}`;
      }
      arcTo(x1, y1, x2, y2, r) {
        x1 = +x1, y1 = +y1, x2 = +x2, y2 = +y2, r = +r;

        // Is the radius negative? Error.
        if (r < 0) throw new Error(`negative radius: ${r}`);

        let x0 = this._x1,
            y0 = this._y1,
            x21 = x2 - x1,
            y21 = y2 - y1,
            x01 = x0 - x1,
            y01 = y0 - y1,
            l01_2 = x01 * x01 + y01 * y01;

        // Is this path empty? Move to (x1,y1).
        if (this._x1 === null) {
          this._append`M${this._x1 = x1},${this._y1 = y1}`;
        }

        // Or, is (x1,y1) coincident with (x0,y0)? Do nothing.
        else if (!(l01_2 > epsilon));

        // Or, are (x0,y0), (x1,y1) and (x2,y2) collinear?
        // Equivalently, is (x1,y1) coincident with (x2,y2)?
        // Or, is the radius zero? Line to (x1,y1).
        else if (!(Math.abs(y01 * x21 - y21 * x01) > epsilon) || !r) {
          this._append`L${this._x1 = x1},${this._y1 = y1}`;
        }

        // Otherwise, draw an arc!
        else {
          let x20 = x2 - x0,
              y20 = y2 - y0,
              l21_2 = x21 * x21 + y21 * y21,
              l20_2 = x20 * x20 + y20 * y20,
              l21 = Math.sqrt(l21_2),
              l01 = Math.sqrt(l01_2),
              l = r * Math.tan((pi - Math.acos((l21_2 + l01_2 - l20_2) / (2 * l21 * l01))) / 2),
              t01 = l / l01,
              t21 = l / l21;

          // If the start tangent is not coincident with (x0,y0), line to.
          if (Math.abs(t01 - 1) > epsilon) {
            this._append`L${x1 + t01 * x01},${y1 + t01 * y01}`;
          }

          this._append`A${r},${r},0,0,${+(y01 * x20 > x01 * y20)},${this._x1 = x1 + t21 * x21},${this._y1 = y1 + t21 * y21}`;
        }
      }
      arc(x, y, r, a0, a1, ccw) {
        x = +x, y = +y, r = +r, ccw = !!ccw;

        // Is the radius negative? Error.
        if (r < 0) throw new Error(`negative radius: ${r}`);

        let dx = r * Math.cos(a0),
            dy = r * Math.sin(a0),
            x0 = x + dx,
            y0 = y + dy,
            cw = 1 ^ ccw,
            da = ccw ? a0 - a1 : a1 - a0;

        // Is this path empty? Move to (x0,y0).
        if (this._x1 === null) {
          this._append`M${x0},${y0}`;
        }

        // Or, is (x0,y0) not coincident with the previous point? Line to (x0,y0).
        else if (Math.abs(this._x1 - x0) > epsilon || Math.abs(this._y1 - y0) > epsilon) {
          this._append`L${x0},${y0}`;
        }

        // Is this arc empty? We’re done.
        if (!r) return;

        // Does the angle go the wrong way? Flip the direction.
        if (da < 0) da = da % tau + tau;

        // Is this a complete circle? Draw two arcs to complete the circle.
        if (da > tauEpsilon) {
          this._append`A${r},${r},0,1,${cw},${x - dx},${y - dy}A${r},${r},0,1,${cw},${this._x1 = x0},${this._y1 = y0}`;
        }

        // Is this arc non-empty? Draw an arc!
        else if (da > epsilon) {
          this._append`A${r},${r},0,${+(da >= pi)},${cw},${this._x1 = x + r * Math.cos(a1)},${this._y1 = y + r * Math.sin(a1)}`;
        }
      }
      rect(x, y, w, h) {
        this._append`M${this._x0 = this._x1 = +x},${this._y0 = this._y1 = +y}h${w = +w}v${+h}h${-w}Z`;
      }
      toString() {
        return this._;
      }
    }

    function withPath(shape) {
      let digits = 3;

      shape.digits = function(_) {
        if (!arguments.length) return digits;
        if (_ == null) {
          digits = null;
        } else {
          const d = Math.floor(_);
          if (!(d >= 0)) throw new RangeError(`invalid digits: ${_}`);
          digits = d;
        }
        return shape;
      };

      return () => new Path(digits);
    }

    function arcInnerRadius(d) {
      return d.innerRadius;
    }

    function arcOuterRadius(d) {
      return d.outerRadius;
    }

    function arcStartAngle(d) {
      return d.startAngle;
    }

    function arcEndAngle(d) {
      return d.endAngle;
    }

    function arcPadAngle(d) {
      return d && d.padAngle; // Note: optional!
    }

    function intersect(x0, y0, x1, y1, x2, y2, x3, y3) {
      var x10 = x1 - x0, y10 = y1 - y0,
          x32 = x3 - x2, y32 = y3 - y2,
          t = y32 * x10 - x32 * y10;
      if (t * t < epsilon$1) return;
      t = (x32 * (y0 - y2) - y32 * (x0 - x2)) / t;
      return [x0 + t * x10, y0 + t * y10];
    }

    // Compute perpendicular offset line of length rc.
    // http://mathworld.wolfram.com/Circle-LineIntersection.html
    function cornerTangents(x0, y0, x1, y1, r1, rc, cw) {
      var x01 = x0 - x1,
          y01 = y0 - y1,
          lo = (cw ? rc : -rc) / sqrt(x01 * x01 + y01 * y01),
          ox = lo * y01,
          oy = -lo * x01,
          x11 = x0 + ox,
          y11 = y0 + oy,
          x10 = x1 + ox,
          y10 = y1 + oy,
          x00 = (x11 + x10) / 2,
          y00 = (y11 + y10) / 2,
          dx = x10 - x11,
          dy = y10 - y11,
          d2 = dx * dx + dy * dy,
          r = r1 - rc,
          D = x11 * y10 - x10 * y11,
          d = (dy < 0 ? -1 : 1) * sqrt(max(0, r * r * d2 - D * D)),
          cx0 = (D * dy - dx * d) / d2,
          cy0 = (-D * dx - dy * d) / d2,
          cx1 = (D * dy + dx * d) / d2,
          cy1 = (-D * dx + dy * d) / d2,
          dx0 = cx0 - x00,
          dy0 = cy0 - y00,
          dx1 = cx1 - x00,
          dy1 = cy1 - y00;

      // Pick the closer of the two intersection points.
      // TODO Is there a faster way to determine which intersection to use?
      if (dx0 * dx0 + dy0 * dy0 > dx1 * dx1 + dy1 * dy1) cx0 = cx1, cy0 = cy1;

      return {
        cx: cx0,
        cy: cy0,
        x01: -ox,
        y01: -oy,
        x11: cx0 * (r1 / r - 1),
        y11: cy0 * (r1 / r - 1)
      };
    }

    function d3_arc() {
      var innerRadius = arcInnerRadius,
          outerRadius = arcOuterRadius,
          cornerRadius = constant(0),
          padRadius = null,
          startAngle = arcStartAngle,
          endAngle = arcEndAngle,
          padAngle = arcPadAngle,
          context = null,
          path = withPath(arc);

      function arc() {
        var buffer,
            r,
            r0 = +innerRadius.apply(this, arguments),
            r1 = +outerRadius.apply(this, arguments),
            a0 = startAngle.apply(this, arguments) - halfPi,
            a1 = endAngle.apply(this, arguments) - halfPi,
            da = abs(a1 - a0),
            cw = a1 > a0;

        if (!context) context = buffer = path();

        // Ensure that the outer radius is always larger than the inner radius.
        if (r1 < r0) r = r1, r1 = r0, r0 = r;

        // Is it a point?
        if (!(r1 > epsilon$1)) context.moveTo(0, 0);

        // Or is it a circle or annulus?
        else if (da > tau$1 - epsilon$1) {
          context.moveTo(r1 * cos(a0), r1 * sin(a0));
          context.arc(0, 0, r1, a0, a1, !cw);
          if (r0 > epsilon$1) {
            context.moveTo(r0 * cos(a1), r0 * sin(a1));
            context.arc(0, 0, r0, a1, a0, cw);
          }
        }

        // Or is it a circular or annular sector?
        else {
          var a01 = a0,
              a11 = a1,
              a00 = a0,
              a10 = a1,
              da0 = da,
              da1 = da,
              ap = padAngle.apply(this, arguments) / 2,
              rp = (ap > epsilon$1) && (padRadius ? +padRadius.apply(this, arguments) : sqrt(r0 * r0 + r1 * r1)),
              rc = min(abs(r1 - r0) / 2, +cornerRadius.apply(this, arguments)),
              rc0 = rc,
              rc1 = rc,
              t0,
              t1;

          // Apply padding? Note that since r1 ≥ r0, da1 ≥ da0.
          if (rp > epsilon$1) {
            var p0 = asin(rp / r0 * sin(ap)),
                p1 = asin(rp / r1 * sin(ap));
            if ((da0 -= p0 * 2) > epsilon$1) p0 *= (cw ? 1 : -1), a00 += p0, a10 -= p0;
            else da0 = 0, a00 = a10 = (a0 + a1) / 2;
            if ((da1 -= p1 * 2) > epsilon$1) p1 *= (cw ? 1 : -1), a01 += p1, a11 -= p1;
            else da1 = 0, a01 = a11 = (a0 + a1) / 2;
          }

          var x01 = r1 * cos(a01),
              y01 = r1 * sin(a01),
              x10 = r0 * cos(a10),
              y10 = r0 * sin(a10);

          // Apply rounded corners?
          if (rc > epsilon$1) {
            var x11 = r1 * cos(a11),
                y11 = r1 * sin(a11),
                x00 = r0 * cos(a00),
                y00 = r0 * sin(a00),
                oc;

            // Restrict the corner radius according to the sector angle. If this
            // intersection fails, it’s probably because the arc is too small, so
            // disable the corner radius entirely.
            if (da < pi$1) {
              if (oc = intersect(x01, y01, x00, y00, x11, y11, x10, y10)) {
                var ax = x01 - oc[0],
                    ay = y01 - oc[1],
                    bx = x11 - oc[0],
                    by = y11 - oc[1],
                    kc = 1 / sin(acos((ax * bx + ay * by) / (sqrt(ax * ax + ay * ay) * sqrt(bx * bx + by * by))) / 2),
                    lc = sqrt(oc[0] * oc[0] + oc[1] * oc[1]);
                rc0 = min(rc, (r0 - lc) / (kc - 1));
                rc1 = min(rc, (r1 - lc) / (kc + 1));
              } else {
                rc0 = rc1 = 0;
              }
            }
          }

          // Is the sector collapsed to a line?
          if (!(da1 > epsilon$1)) context.moveTo(x01, y01);

          // Does the sector’s outer ring have rounded corners?
          else if (rc1 > epsilon$1) {
            t0 = cornerTangents(x00, y00, x01, y01, r1, rc1, cw);
            t1 = cornerTangents(x11, y11, x10, y10, r1, rc1, cw);

            context.moveTo(t0.cx + t0.x01, t0.cy + t0.y01);

            // Have the corners merged?
            if (rc1 < rc) context.arc(t0.cx, t0.cy, rc1, atan2(t0.y01, t0.x01), atan2(t1.y01, t1.x01), !cw);

            // Otherwise, draw the two corners and the ring.
            else {
              context.arc(t0.cx, t0.cy, rc1, atan2(t0.y01, t0.x01), atan2(t0.y11, t0.x11), !cw);
              context.arc(0, 0, r1, atan2(t0.cy + t0.y11, t0.cx + t0.x11), atan2(t1.cy + t1.y11, t1.cx + t1.x11), !cw);
              context.arc(t1.cx, t1.cy, rc1, atan2(t1.y11, t1.x11), atan2(t1.y01, t1.x01), !cw);
            }
          }

          // Or is the outer ring just a circular arc?
          else context.moveTo(x01, y01), context.arc(0, 0, r1, a01, a11, !cw);

          // Is there no inner ring, and it’s a circular sector?
          // Or perhaps it’s an annular sector collapsed due to padding?
          if (!(r0 > epsilon$1) || !(da0 > epsilon$1)) context.lineTo(x10, y10);

          // Does the sector’s inner ring (or point) have rounded corners?
          else if (rc0 > epsilon$1) {
            t0 = cornerTangents(x10, y10, x11, y11, r0, -rc0, cw);
            t1 = cornerTangents(x01, y01, x00, y00, r0, -rc0, cw);

            context.lineTo(t0.cx + t0.x01, t0.cy + t0.y01);

            // Have the corners merged?
            if (rc0 < rc) context.arc(t0.cx, t0.cy, rc0, atan2(t0.y01, t0.x01), atan2(t1.y01, t1.x01), !cw);

            // Otherwise, draw the two corners and the ring.
            else {
              context.arc(t0.cx, t0.cy, rc0, atan2(t0.y01, t0.x01), atan2(t0.y11, t0.x11), !cw);
              context.arc(0, 0, r0, atan2(t0.cy + t0.y11, t0.cx + t0.x11), atan2(t1.cy + t1.y11, t1.cx + t1.x11), cw);
              context.arc(t1.cx, t1.cy, rc0, atan2(t1.y11, t1.x11), atan2(t1.y01, t1.x01), !cw);
            }
          }

          // Or is the inner ring just a circular arc?
          else context.arc(0, 0, r0, a10, a00, cw);
        }

        context.closePath();

        if (buffer) return context = null, buffer + "" || null;
      }

      arc.centroid = function() {
        var r = (+innerRadius.apply(this, arguments) + +outerRadius.apply(this, arguments)) / 2,
            a = (+startAngle.apply(this, arguments) + +endAngle.apply(this, arguments)) / 2 - pi$1 / 2;
        return [cos(a) * r, sin(a) * r];
      };

      arc.innerRadius = function(_) {
        return arguments.length ? (innerRadius = typeof _ === "function" ? _ : constant(+_), arc) : innerRadius;
      };

      arc.outerRadius = function(_) {
        return arguments.length ? (outerRadius = typeof _ === "function" ? _ : constant(+_), arc) : outerRadius;
      };

      arc.cornerRadius = function(_) {
        return arguments.length ? (cornerRadius = typeof _ === "function" ? _ : constant(+_), arc) : cornerRadius;
      };

      arc.padRadius = function(_) {
        return arguments.length ? (padRadius = _ == null ? null : typeof _ === "function" ? _ : constant(+_), arc) : padRadius;
      };

      arc.startAngle = function(_) {
        return arguments.length ? (startAngle = typeof _ === "function" ? _ : constant(+_), arc) : startAngle;
      };

      arc.endAngle = function(_) {
        return arguments.length ? (endAngle = typeof _ === "function" ? _ : constant(+_), arc) : endAngle;
      };

      arc.padAngle = function(_) {
        return arguments.length ? (padAngle = typeof _ === "function" ? _ : constant(+_), arc) : padAngle;
      };

      arc.context = function(_) {
        return arguments.length ? ((context = _ == null ? null : _), arc) : context;
      };

      return arc;
    }

    function array(x) {
      return typeof x === "object" && "length" in x
        ? x // Array, TypedArray, NodeList, array-like
        : Array.from(x); // Map, Set, iterable, string, or anything else
    }

    function Linear(context) {
      this._context = context;
    }

    Linear.prototype = {
      areaStart: function() {
        this._line = 0;
      },
      areaEnd: function() {
        this._line = NaN;
      },
      lineStart: function() {
        this._point = 0;
      },
      lineEnd: function() {
        if (this._line || (this._line !== 0 && this._point === 1)) this._context.closePath();
        this._line = 1 - this._line;
      },
      point: function(x, y) {
        x = +x, y = +y;
        switch (this._point) {
          case 0: this._point = 1; this._line ? this._context.lineTo(x, y) : this._context.moveTo(x, y); break;
          case 1: this._point = 2; // falls through
          default: this._context.lineTo(x, y); break;
        }
      }
    };

    function curveLinear(context) {
      return new Linear(context);
    }

    function x$1(p) {
      return p[0];
    }

    function y$1(p) {
      return p[1];
    }

    function d3_line(x, y) {
      var defined = constant(true),
          context = null,
          curve = curveLinear,
          output = null,
          path = withPath(line);

      x = typeof x === "function" ? x : (x === undefined) ? x$1 : constant(x);
      y = typeof y === "function" ? y : (y === undefined) ? y$1 : constant(y);

      function line(data) {
        var i,
            n = (data = array(data)).length,
            d,
            defined0 = false,
            buffer;

        if (context == null) output = curve(buffer = path());

        for (i = 0; i <= n; ++i) {
          if (!(i < n && defined(d = data[i], i, data)) === defined0) {
            if (defined0 = !defined0) output.lineStart();
            else output.lineEnd();
          }
          if (defined0) output.point(+x(d, i, data), +y(d, i, data));
        }

        if (buffer) return output = null, buffer + "" || null;
      }

      line.x = function(_) {
        return arguments.length ? (x = typeof _ === "function" ? _ : constant(+_), line) : x;
      };

      line.y = function(_) {
        return arguments.length ? (y = typeof _ === "function" ? _ : constant(+_), line) : y;
      };

      line.defined = function(_) {
        return arguments.length ? (defined = typeof _ === "function" ? _ : constant(!!_), line) : defined;
      };

      line.curve = function(_) {
        return arguments.length ? (curve = _, context != null && (output = curve(context)), line) : curve;
      };

      line.context = function(_) {
        return arguments.length ? (_ == null ? context = output = null : output = curve(context = _), line) : context;
      };

      return line;
    }

    function d3_area(x0, y0, y1) {
      var x1 = null,
          defined = constant(true),
          context = null,
          curve = curveLinear,
          output = null,
          path = withPath(area);

      x0 = typeof x0 === "function" ? x0 : (x0 === undefined) ? x$1 : constant(+x0);
      y0 = typeof y0 === "function" ? y0 : (y0 === undefined) ? constant(0) : constant(+y0);
      y1 = typeof y1 === "function" ? y1 : (y1 === undefined) ? y$1 : constant(+y1);

      function area(data) {
        var i,
            j,
            k,
            n = (data = array(data)).length,
            d,
            defined0 = false,
            buffer,
            x0z = new Array(n),
            y0z = new Array(n);

        if (context == null) output = curve(buffer = path());

        for (i = 0; i <= n; ++i) {
          if (!(i < n && defined(d = data[i], i, data)) === defined0) {
            if (defined0 = !defined0) {
              j = i;
              output.areaStart();
              output.lineStart();
            } else {
              output.lineEnd();
              output.lineStart();
              for (k = i - 1; k >= j; --k) {
                output.point(x0z[k], y0z[k]);
              }
              output.lineEnd();
              output.areaEnd();
            }
          }
          if (defined0) {
            x0z[i] = +x0(d, i, data), y0z[i] = +y0(d, i, data);
            output.point(x1 ? +x1(d, i, data) : x0z[i], y1 ? +y1(d, i, data) : y0z[i]);
          }
        }

        if (buffer) return output = null, buffer + "" || null;
      }

      function arealine() {
        return d3_line().defined(defined).curve(curve).context(context);
      }

      area.x = function(_) {
        return arguments.length ? (x0 = typeof _ === "function" ? _ : constant(+_), x1 = null, area) : x0;
      };

      area.x0 = function(_) {
        return arguments.length ? (x0 = typeof _ === "function" ? _ : constant(+_), area) : x0;
      };

      area.x1 = function(_) {
        return arguments.length ? (x1 = _ == null ? null : typeof _ === "function" ? _ : constant(+_), area) : x1;
      };

      area.y = function(_) {
        return arguments.length ? (y0 = typeof _ === "function" ? _ : constant(+_), y1 = null, area) : y0;
      };

      area.y0 = function(_) {
        return arguments.length ? (y0 = typeof _ === "function" ? _ : constant(+_), area) : y0;
      };

      area.y1 = function(_) {
        return arguments.length ? (y1 = _ == null ? null : typeof _ === "function" ? _ : constant(+_), area) : y1;
      };

      area.lineX0 =
      area.lineY0 = function() {
        return arealine().x(x0).y(y0);
      };

      area.lineY1 = function() {
        return arealine().x(x0).y(y1);
      };

      area.lineX1 = function() {
        return arealine().x(x1).y(y0);
      };

      area.defined = function(_) {
        return arguments.length ? (defined = typeof _ === "function" ? _ : constant(!!_), area) : defined;
      };

      area.curve = function(_) {
        return arguments.length ? (curve = _, context != null && (output = curve(context)), area) : curve;
      };

      area.context = function(_) {
        return arguments.length ? (_ == null ? context = output = null : output = curve(context = _), area) : context;
      };

      return area;
    }

    var circle = {
      draw(context, size) {
        const r = sqrt(size / pi$1);
        context.moveTo(r, 0);
        context.arc(0, 0, r, 0, tau$1);
      }
    };

    function Symbol(type, size) {
      let context = null,
          path = withPath(symbol);

      type = typeof type === "function" ? type : constant(type || circle);
      size = typeof size === "function" ? size : constant(size === undefined ? 64 : +size);

      function symbol() {
        let buffer;
        if (!context) context = buffer = path();
        type.apply(this, arguments).draw(context, +size.apply(this, arguments));
        if (buffer) return context = null, buffer + "" || null;
      }

      symbol.type = function(_) {
        return arguments.length ? (type = typeof _ === "function" ? _ : constant(_), symbol) : type;
      };

      symbol.size = function(_) {
        return arguments.length ? (size = typeof _ === "function" ? _ : constant(+_), symbol) : size;
      };

      symbol.context = function(_) {
        return arguments.length ? (context = _ == null ? null : _, symbol) : context;
      };

      return symbol;
    }

    function getDefaultExportFromCjs (x) {
    	return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, 'default') ? x['default'] : x;
    }

    var _function;
    var hasRequired_function;

    function require_function () {
    	if (hasRequired_function) return _function;
    	hasRequired_function = 1;
    	function clone(point) { //TODO: use gl-vec2 for this
    	    return [point[0], point[1]]
    	}

    	function vec2(x, y) {
    	    return [x, y]
    	}

    	_function = function createBezierBuilder(opt) {
    	    opt = opt||{};

    	    var RECURSION_LIMIT = typeof opt.recursion === 'number' ? opt.recursion : 8;
    	    var FLT_EPSILON = typeof opt.epsilon === 'number' ? opt.epsilon : 1.19209290e-7;
    	    var PATH_DISTANCE_EPSILON = typeof opt.pathEpsilon === 'number' ? opt.pathEpsilon : 1.0;

    	    var curve_angle_tolerance_epsilon = typeof opt.angleEpsilon === 'number' ? opt.angleEpsilon : 0.01;
    	    var m_angle_tolerance = opt.angleTolerance || 0;
    	    var m_cusp_limit = opt.cuspLimit || 0;

    	    return function bezierCurve(start, c1, c2, end, scale, points) {
    	        if (!points)
    	            points = [];

    	        scale = typeof scale === 'number' ? scale : 1.0;
    	        var distanceTolerance = PATH_DISTANCE_EPSILON / scale;
    	        distanceTolerance *= distanceTolerance;
    	        begin(start, c1, c2, end, points, distanceTolerance);
    	        return points
    	    }


    	    ////// Based on:
    	    ////// https://github.com/pelson/antigrain/blob/master/agg-2.4/src/agg_curves.cpp

    	    function begin(start, c1, c2, end, points, distanceTolerance) {
    	        points.push(clone(start));
    	        var x1 = start[0],
    	            y1 = start[1],
    	            x2 = c1[0],
    	            y2 = c1[1],
    	            x3 = c2[0],
    	            y3 = c2[1],
    	            x4 = end[0],
    	            y4 = end[1];
    	        recursive(x1, y1, x2, y2, x3, y3, x4, y4, points, distanceTolerance, 0);
    	        points.push(clone(end));
    	    }

    	    function recursive(x1, y1, x2, y2, x3, y3, x4, y4, points, distanceTolerance, level) {
    	        if(level > RECURSION_LIMIT) 
    	            return

    	        var pi = Math.PI;

    	        // Calculate all the mid-points of the line segments
    	        //----------------------
    	        var x12   = (x1 + x2) / 2;
    	        var y12   = (y1 + y2) / 2;
    	        var x23   = (x2 + x3) / 2;
    	        var y23   = (y2 + y3) / 2;
    	        var x34   = (x3 + x4) / 2;
    	        var y34   = (y3 + y4) / 2;
    	        var x123  = (x12 + x23) / 2;
    	        var y123  = (y12 + y23) / 2;
    	        var x234  = (x23 + x34) / 2;
    	        var y234  = (y23 + y34) / 2;
    	        var x1234 = (x123 + x234) / 2;
    	        var y1234 = (y123 + y234) / 2;

    	        if(level > 0) { // Enforce subdivision first time
    	            // Try to approximate the full cubic curve by a single straight line
    	            //------------------
    	            var dx = x4-x1;
    	            var dy = y4-y1;

    	            var d2 = Math.abs((x2 - x4) * dy - (y2 - y4) * dx);
    	            var d3 = Math.abs((x3 - x4) * dy - (y3 - y4) * dx);

    	            var da1, da2;

    	            if(d2 > FLT_EPSILON && d3 > FLT_EPSILON) {
    	                // Regular care
    	                //-----------------
    	                if((d2 + d3)*(d2 + d3) <= distanceTolerance * (dx*dx + dy*dy)) {
    	                    // If the curvature doesn't exceed the distanceTolerance value
    	                    // we tend to finish subdivisions.
    	                    //----------------------
    	                    if(m_angle_tolerance < curve_angle_tolerance_epsilon) {
    	                        points.push(vec2(x1234, y1234));
    	                        return
    	                    }

    	                    // Angle & Cusp Condition
    	                    //----------------------
    	                    var a23 = Math.atan2(y3 - y2, x3 - x2);
    	                    da1 = Math.abs(a23 - Math.atan2(y2 - y1, x2 - x1));
    	                    da2 = Math.abs(Math.atan2(y4 - y3, x4 - x3) - a23);
    	                    if(da1 >= pi) da1 = 2*pi - da1;
    	                    if(da2 >= pi) da2 = 2*pi - da2;

    	                    if(da1 + da2 < m_angle_tolerance) {
    	                        // Finally we can stop the recursion
    	                        //----------------------
    	                        points.push(vec2(x1234, y1234));
    	                        return
    	                    }

    	                    if(m_cusp_limit !== 0.0) {
    	                        if(da1 > m_cusp_limit) {
    	                            points.push(vec2(x2, y2));
    	                            return
    	                        }

    	                        if(da2 > m_cusp_limit) {
    	                            points.push(vec2(x3, y3));
    	                            return
    	                        }
    	                    }
    	                }
    	            }
    	            else {
    	                if(d2 > FLT_EPSILON) {
    	                    // p1,p3,p4 are collinear, p2 is considerable
    	                    //----------------------
    	                    if(d2 * d2 <= distanceTolerance * (dx*dx + dy*dy)) {
    	                        if(m_angle_tolerance < curve_angle_tolerance_epsilon) {
    	                            points.push(vec2(x1234, y1234));
    	                            return
    	                        }

    	                        // Angle Condition
    	                        //----------------------
    	                        da1 = Math.abs(Math.atan2(y3 - y2, x3 - x2) - Math.atan2(y2 - y1, x2 - x1));
    	                        if(da1 >= pi) da1 = 2*pi - da1;

    	                        if(da1 < m_angle_tolerance) {
    	                            points.push(vec2(x2, y2));
    	                            points.push(vec2(x3, y3));
    	                            return
    	                        }

    	                        if(m_cusp_limit !== 0.0) {
    	                            if(da1 > m_cusp_limit) {
    	                                points.push(vec2(x2, y2));
    	                                return
    	                            }
    	                        }
    	                    }
    	                }
    	                else if(d3 > FLT_EPSILON) {
    	                    // p1,p2,p4 are collinear, p3 is considerable
    	                    //----------------------
    	                    if(d3 * d3 <= distanceTolerance * (dx*dx + dy*dy)) {
    	                        if(m_angle_tolerance < curve_angle_tolerance_epsilon) {
    	                            points.push(vec2(x1234, y1234));
    	                            return
    	                        }

    	                        // Angle Condition
    	                        //----------------------
    	                        da1 = Math.abs(Math.atan2(y4 - y3, x4 - x3) - Math.atan2(y3 - y2, x3 - x2));
    	                        if(da1 >= pi) da1 = 2*pi - da1;

    	                        if(da1 < m_angle_tolerance) {
    	                            points.push(vec2(x2, y2));
    	                            points.push(vec2(x3, y3));
    	                            return
    	                        }

    	                        if(m_cusp_limit !== 0.0) {
    	                            if(da1 > m_cusp_limit)
    	                            {
    	                                points.push(vec2(x3, y3));
    	                                return
    	                            }
    	                        }
    	                    }
    	                }
    	                else {
    	                    // Collinear case
    	                    //-----------------
    	                    dx = x1234 - (x1 + x4) / 2;
    	                    dy = y1234 - (y1 + y4) / 2;
    	                    if(dx*dx + dy*dy <= distanceTolerance) {
    	                        points.push(vec2(x1234, y1234));
    	                        return
    	                    }
    	                }
    	            }
    	        }

    	        // Continue subdivision
    	        //----------------------
    	        recursive(x1, y1, x12, y12, x123, y123, x1234, y1234, points, distanceTolerance, level + 1); 
    	        recursive(x1234, y1234, x234, y234, x34, y34, x4, y4, points, distanceTolerance, level + 1); 
    	    }
    	};
    	return _function;
    }

    var adaptiveBezierCurve;
    var hasRequiredAdaptiveBezierCurve;

    function requireAdaptiveBezierCurve () {
    	if (hasRequiredAdaptiveBezierCurve) return adaptiveBezierCurve;
    	hasRequiredAdaptiveBezierCurve = 1;
    	adaptiveBezierCurve = require_function()();
    	return adaptiveBezierCurve;
    }

    var adaptiveBezierCurveExports = requireAdaptiveBezierCurve();
    var bezier = /*@__PURE__*/getDefaultExportFromCjs(adaptiveBezierCurveExports);

    var simplifyPath = {exports: {}};

    var radialDistance;
    var hasRequiredRadialDistance;

    function requireRadialDistance () {
    	if (hasRequiredRadialDistance) return radialDistance;
    	hasRequiredRadialDistance = 1;
    	function getSqDist(p1, p2) {
    	    var dx = p1[0] - p2[0],
    	        dy = p1[1] - p2[1];

    	    return dx * dx + dy * dy;
    	}

    	// basic distance-based simplification
    	radialDistance = function simplifyRadialDist(points, tolerance) {
    	    if (points.length<=1)
    	        return points;
    	    tolerance = typeof tolerance === 'number' ? tolerance : 1;
    	    var sqTolerance = tolerance * tolerance;
    	    
    	    var prevPoint = points[0],
    	        newPoints = [prevPoint],
    	        point;

    	    for (var i = 1, len = points.length; i < len; i++) {
    	        point = points[i];

    	        if (getSqDist(point, prevPoint) > sqTolerance) {
    	            newPoints.push(point);
    	            prevPoint = point;
    	        }
    	    }

    	    if (prevPoint !== point) newPoints.push(point);

    	    return newPoints;
    	};
    	return radialDistance;
    }

    var douglasPeucker;
    var hasRequiredDouglasPeucker;

    function requireDouglasPeucker () {
    	if (hasRequiredDouglasPeucker) return douglasPeucker;
    	hasRequiredDouglasPeucker = 1;
    	// square distance from a point to a segment
    	function getSqSegDist(p, p1, p2) {
    	    var x = p1[0],
    	        y = p1[1],
    	        dx = p2[0] - x,
    	        dy = p2[1] - y;

    	    if (dx !== 0 || dy !== 0) {

    	        var t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);

    	        if (t > 1) {
    	            x = p2[0];
    	            y = p2[1];

    	        } else if (t > 0) {
    	            x += dx * t;
    	            y += dy * t;
    	        }
    	    }

    	    dx = p[0] - x;
    	    dy = p[1] - y;

    	    return dx * dx + dy * dy;
    	}

    	function simplifyDPStep(points, first, last, sqTolerance, simplified) {
    	    var maxSqDist = sqTolerance,
    	        index;

    	    for (var i = first + 1; i < last; i++) {
    	        var sqDist = getSqSegDist(points[i], points[first], points[last]);

    	        if (sqDist > maxSqDist) {
    	            index = i;
    	            maxSqDist = sqDist;
    	        }
    	    }

    	    if (maxSqDist > sqTolerance) {
    	        if (index - first > 1) simplifyDPStep(points, first, index, sqTolerance, simplified);
    	        simplified.push(points[index]);
    	        if (last - index > 1) simplifyDPStep(points, index, last, sqTolerance, simplified);
    	    }
    	}

    	// simplification using Ramer-Douglas-Peucker algorithm
    	douglasPeucker = function simplifyDouglasPeucker(points, tolerance) {
    	    if (points.length<=1)
    	        return points;
    	    tolerance = typeof tolerance === 'number' ? tolerance : 1;
    	    var sqTolerance = tolerance * tolerance;
    	    
    	    var last = points.length - 1;

    	    var simplified = [points[0]];
    	    simplifyDPStep(points, 0, last, sqTolerance, simplified);
    	    simplified.push(points[last]);

    	    return simplified;
    	};
    	return douglasPeucker;
    }

    var hasRequiredSimplifyPath;

    function requireSimplifyPath () {
    	if (hasRequiredSimplifyPath) return simplifyPath.exports;
    	hasRequiredSimplifyPath = 1;
    	var simplifyRadialDist = requireRadialDistance();
    	var simplifyDouglasPeucker = requireDouglasPeucker();

    	//simplifies using both algorithms
    	simplifyPath.exports = function simplify(points, tolerance) {
    	    points = simplifyRadialDist(points, tolerance);
    	    points = simplifyDouglasPeucker(points, tolerance);
    	    return points;
    	};

    	simplifyPath.exports.radialDistance = simplifyRadialDist;
    	simplifyPath.exports.douglasPeucker = simplifyDouglasPeucker;
    	return simplifyPath.exports;
    }

    var simplifyPathExports = requireSimplifyPath();
    var simplify = /*@__PURE__*/getDefaultExportFromCjs(simplifyPathExports);

    /*
    ** SGI FREE SOFTWARE LICENSE B (Version 2.0, Sept. 18, 2008) 
    ** Copyright (C) [dates of first publication] Silicon Graphics, Inc.
    ** All Rights Reserved.
    **
    ** Permission is hereby granted, free of charge, to any person obtaining a copy
    ** of this software and associated documentation files (the "Software"), to deal
    ** in the Software without restriction, including without limitation the rights
    ** to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
    ** of the Software, and to permit persons to whom the Software is furnished to do so,
    ** subject to the following conditions:
    ** 
    ** The above copyright notice including the dates of first publication and either this
    ** permission notice or a reference to http://oss.sgi.com/projects/FreeB/ shall be
    ** included in all copies or substantial portions of the Software. 
    **
    ** THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
    ** INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
    ** PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL SILICON GRAPHICS, INC.
    ** BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
    ** TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE
    ** OR OTHER DEALINGS IN THE SOFTWARE.
    ** 
    ** Except as contained in this notice, the name of Silicon Graphics, Inc. shall not
    ** be used in advertising or otherwise to promote the sale, use or other dealings in
    ** this Software without prior written authorization from Silicon Graphics, Inc.
    */

    var tess2$1;
    var hasRequiredTess2$1;

    function requireTess2$1 () {
    	if (hasRequiredTess2$1) return tess2$1;
    	hasRequiredTess2$1 = 1;

    		/* Public API */

    		var Tess2 = {};

    		tess2$1 = Tess2;
    		
    		Tess2.WINDING_ODD = 0;
    		Tess2.WINDING_NONZERO = 1;
    		Tess2.WINDING_POSITIVE = 2;
    		Tess2.WINDING_NEGATIVE = 3;
    		Tess2.WINDING_ABS_GEQ_TWO = 4;

    		Tess2.POLYGONS = 0;
    		Tess2.CONNECTED_POLYGONS = 1;
    		Tess2.BOUNDARY_CONTOURS = 2;

    		Tess2.tesselate = function(opts) {
    			var debug =  opts.debug || false;
    			var tess = new Tesselator();
    			for (var i = 0; i < opts.contours.length; i++) {
    				tess.addContour(opts.vertexSize || 2, opts.contours[i]);
    			}
    			tess.tesselate(opts.windingRule || Tess2.WINDING_ODD,
    						   opts.elementType || Tess2.POLYGONS,
    						   opts.polySize || 3,
    						   opts.vertexSize || 2,
    						   opts.normal || [0,0,1]);
    			return {
    				vertices: tess.vertices,
    				vertexIndices: tess.vertexIndices,
    				vertexCount: tess.vertexCount,
    				elements: tess.elements,
    				elementCount: tess.elementCount,
    				mesh: debug ? tess.mesh : undefined
    			};
    		};

    		/* Internal */

    		var assert = function(cond) {
    			if (!cond) {
    				throw "Assertion Failed!";
    			}
    		};

    		/* The mesh structure is similar in spirit, notation, and operations
    		* to the "quad-edge" structure (see L. Guibas and J. Stolfi, Primitives
    		* for the manipulation of general subdivisions and the computation of
    		* Voronoi diagrams, ACM Transactions on Graphics, 4(2):74-123, April 1985).
    		* For a simplified description, see the course notes for CS348a,
    		* "Mathematical Foundations of Computer Graphics", available at the
    		* Stanford bookstore (and taught during the fall quarter).
    		* The implementation also borrows a tiny subset of the graph-based approach
    		* use in Mantyla's Geometric Work Bench (see M. Mantyla, An Introduction
    		* to Sold Modeling, Computer Science Press, Rockville, Maryland, 1988).
    		*
    		* The fundamental data structure is the "half-edge".  Two half-edges
    		* go together to make an edge, but they point in opposite directions.
    		* Each half-edge has a pointer to its mate (the "symmetric" half-edge Sym),
    		* its origin vertex (Org), the face on its left side (Lface), and the
    		* adjacent half-edges in the CCW direction around the origin vertex
    		* (Onext) and around the left face (Lnext).  There is also a "next"
    		* pointer for the global edge list (see below).
    		*
    		* The notation used for mesh navigation:
    		*  Sym   = the mate of a half-edge (same edge, but opposite direction)
    		*  Onext = edge CCW around origin vertex (keep same origin)
    		*  Dnext = edge CCW around destination vertex (keep same dest)
    		*  Lnext = edge CCW around left face (dest becomes new origin)
    		*  Rnext = edge CCW around right face (origin becomes new dest)
    		*
    		* "prev" means to substitute CW for CCW in the definitions above.
    		*
    		* The mesh keeps global lists of all vertices, faces, and edges,
    		* stored as doubly-linked circular lists with a dummy header node.
    		* The mesh stores pointers to these dummy headers (vHead, fHead, eHead).
    		*
    		* The circular edge list is special; since half-edges always occur
    		* in pairs (e and e->Sym), each half-edge stores a pointer in only
    		* one direction.  Starting at eHead and following the e->next pointers
    		* will visit each *edge* once (ie. e or e->Sym, but not both).
    		* e->Sym stores a pointer in the opposite direction, thus it is
    		* always true that e->Sym->next->Sym->next == e.
    		*
    		* Each vertex has a pointer to next and previous vertices in the
    		* circular list, and a pointer to a half-edge with this vertex as
    		* the origin (NULL if this is the dummy header).  There is also a
    		* field "data" for client data.
    		*
    		* Each face has a pointer to the next and previous faces in the
    		* circular list, and a pointer to a half-edge with this face as
    		* the left face (NULL if this is the dummy header).  There is also
    		* a field "data" for client data.
    		*
    		* Note that what we call a "face" is really a loop; faces may consist
    		* of more than one loop (ie. not simply connected), but there is no
    		* record of this in the data structure.  The mesh may consist of
    		* several disconnected regions, so it may not be possible to visit
    		* the entire mesh by starting at a half-edge and traversing the edge
    		* structure.
    		*
    		* The mesh does NOT support isolated vertices; a vertex is deleted along
    		* with its last edge.  Similarly when two faces are merged, one of the
    		* faces is deleted (see tessMeshDelete below).  For mesh operations,
    		* all face (loop) and vertex pointers must not be NULL.  However, once
    		* mesh manipulation is finished, TESSmeshZapFace can be used to delete
    		* faces of the mesh, one at a time.  All external faces can be "zapped"
    		* before the mesh is returned to the client; then a NULL face indicates
    		* a region which is not part of the output polygon.
    		*/

    		function TESSvertex() {
    			this.next = null;	/* next vertex (never NULL) */
    			this.prev = null;	/* previous vertex (never NULL) */
    			this.anEdge = null;	/* a half-edge with this origin */

    			/* Internal data (keep hidden) */
    			this.coords = [0,0,0];	/* vertex location in 3D */
    			this.s = 0.0;
    			this.t = 0.0;			/* projection onto the sweep plane */
    			this.pqHandle = 0;		/* to allow deletion from priority queue */
    			this.n = 0;				/* to allow identify unique vertices */
    			this.idx = 0;			/* to allow map result to original verts */
    		} 

    		function TESSface() {
    			this.next = null;		/* next face (never NULL) */
    			this.prev = null;		/* previous face (never NULL) */
    			this.anEdge = null;		/* a half edge with this left face */

    			/* Internal data (keep hidden) */
    			this.trail = null;		/* "stack" for conversion to strips */
    			this.n = 0;				/* to allow identiy unique faces */
    			this.marked = false;	/* flag for conversion to strips */
    			this.inside = false;	/* this face is in the polygon interior */
    		}
    		function TESShalfEdge(side) {
    			this.next = null;		/* doubly-linked list (prev==Sym->next) */
    			this.Sym = null;		/* same edge, opposite direction */
    			this.Onext = null;		/* next edge CCW around origin */
    			this.Lnext = null;		/* next edge CCW around left face */
    			this.Org = null;		/* origin vertex (Overtex too long) */
    			this.Lface = null;		/* left face */

    			/* Internal data (keep hidden) */
    			this.activeRegion = null;	/* a region with this upper edge (sweep.c) */
    			this.winding = 0;			/* change in winding number when crossing
    										   from the right face to the left face */
    			this.side = side;
    		}
    		TESShalfEdge.prototype = {
    			get Rface() { return this.Sym.Lface; },
    			set Rface(v) { this.Sym.Lface = v; },
    			get Dst() { return this.Sym.Org; },
    			set Dst(v) { this.Sym.Org = v; },
    			get Oprev() { return this.Sym.Lnext; },
    			set Oprev(v) { this.Sym.Lnext = v; },
    			get Lprev() { return this.Onext.Sym; },
    			set Lprev(v) { this.Onext.Sym = v; },
    			get Dprev() { return this.Lnext.Sym; },
    			set Dprev(v) { this.Lnext.Sym = v; },
    			get Rprev() { return this.Sym.Onext; },
    			set Rprev(v) { this.Sym.Onext = v; },
    			get Dnext() { return /*this.Rprev*/this.Sym.Onext.Sym; },  /* 3 pointers */
    			set Dnext(v) { /*this.Rprev*/this.Sym.Onext.Sym = v; },  /* 3 pointers */
    			get Rnext() { return /*this.Oprev*/this.Sym.Lnext.Sym; },  /* 3 pointers */
    			set Rnext(v) { /*this.Oprev*/this.Sym.Lnext.Sym = v; },  /* 3 pointers */
    		};



    		function TESSmesh() {
    			var v = new TESSvertex();
    			var f = new TESSface();
    			var e = new TESShalfEdge(0);
    			var eSym = new TESShalfEdge(1);

    			v.next = v.prev = v;
    			v.anEdge = null;

    			f.next = f.prev = f;
    			f.anEdge = null;
    			f.trail = null;
    			f.marked = false;
    			f.inside = false;

    			e.next = e;
    			e.Sym = eSym;
    			e.Onext = null;
    			e.Lnext = null;
    			e.Org = null;
    			e.Lface = null;
    			e.winding = 0;
    			e.activeRegion = null;

    			eSym.next = eSym;
    			eSym.Sym = e;
    			eSym.Onext = null;
    			eSym.Lnext = null;
    			eSym.Org = null;
    			eSym.Lface = null;
    			eSym.winding = 0;
    			eSym.activeRegion = null;

    			this.vHead = v;		/* dummy header for vertex list */
    			this.fHead = f;		/* dummy header for face list */
    			this.eHead = e;		/* dummy header for edge list */
    			this.eHeadSym = eSym;	/* and its symmetric counterpart */
    		}
    		/* The mesh operations below have three motivations: completeness,
    		* convenience, and efficiency.  The basic mesh operations are MakeEdge,
    		* Splice, and Delete.  All the other edge operations can be implemented
    		* in terms of these.  The other operations are provided for convenience
    		* and/or efficiency.
    		*
    		* When a face is split or a vertex is added, they are inserted into the
    		* global list *before* the existing vertex or face (ie. e->Org or e->Lface).
    		* This makes it easier to process all vertices or faces in the global lists
    		* without worrying about processing the same data twice.  As a convenience,
    		* when a face is split, the "inside" flag is copied from the old face.
    		* Other internal data (v->data, v->activeRegion, f->data, f->marked,
    		* f->trail, e->winding) is set to zero.
    		*
    		* ********************** Basic Edge Operations **************************
    		*
    		* tessMeshMakeEdge( mesh ) creates one edge, two vertices, and a loop.
    		* The loop (face) consists of the two new half-edges.
    		*
    		* tessMeshSplice( eOrg, eDst ) is the basic operation for changing the
    		* mesh connectivity and topology.  It changes the mesh so that
    		*  eOrg->Onext <- OLD( eDst->Onext )
    		*  eDst->Onext <- OLD( eOrg->Onext )
    		* where OLD(...) means the value before the meshSplice operation.
    		*
    		* This can have two effects on the vertex structure:
    		*  - if eOrg->Org != eDst->Org, the two vertices are merged together
    		*  - if eOrg->Org == eDst->Org, the origin is split into two vertices
    		* In both cases, eDst->Org is changed and eOrg->Org is untouched.
    		*
    		* Similarly (and independently) for the face structure,
    		*  - if eOrg->Lface == eDst->Lface, one loop is split into two
    		*  - if eOrg->Lface != eDst->Lface, two distinct loops are joined into one
    		* In both cases, eDst->Lface is changed and eOrg->Lface is unaffected.
    		*
    		* tessMeshDelete( eDel ) removes the edge eDel.  There are several cases:
    		* if (eDel->Lface != eDel->Rface), we join two loops into one; the loop
    		* eDel->Lface is deleted.  Otherwise, we are splitting one loop into two;
    		* the newly created loop will contain eDel->Dst.  If the deletion of eDel
    		* would create isolated vertices, those are deleted as well.
    		*
    		* ********************** Other Edge Operations **************************
    		*
    		* tessMeshAddEdgeVertex( eOrg ) creates a new edge eNew such that
    		* eNew == eOrg->Lnext, and eNew->Dst is a newly created vertex.
    		* eOrg and eNew will have the same left face.
    		*
    		* tessMeshSplitEdge( eOrg ) splits eOrg into two edges eOrg and eNew,
    		* such that eNew == eOrg->Lnext.  The new vertex is eOrg->Dst == eNew->Org.
    		* eOrg and eNew will have the same left face.
    		*
    		* tessMeshConnect( eOrg, eDst ) creates a new edge from eOrg->Dst
    		* to eDst->Org, and returns the corresponding half-edge eNew.
    		* If eOrg->Lface == eDst->Lface, this splits one loop into two,
    		* and the newly created loop is eNew->Lface.  Otherwise, two disjoint
    		* loops are merged into one, and the loop eDst->Lface is destroyed.
    		*
    		* ************************ Other Operations *****************************
    		*
    		* tessMeshNewMesh() creates a new mesh with no edges, no vertices,
    		* and no loops (what we usually call a "face").
    		*
    		* tessMeshUnion( mesh1, mesh2 ) forms the union of all structures in
    		* both meshes, and returns the new mesh (the old meshes are destroyed).
    		*
    		* tessMeshDeleteMesh( mesh ) will free all storage for any valid mesh.
    		*
    		* tessMeshZapFace( fZap ) destroys a face and removes it from the
    		* global face list.  All edges of fZap will have a NULL pointer as their
    		* left face.  Any edges which also have a NULL pointer as their right face
    		* are deleted entirely (along with any isolated vertices this produces).
    		* An entire mesh can be deleted by zapping its faces, one at a time,
    		* in any order.  Zapped faces cannot be used in further mesh operations!
    		*
    		* tessMeshCheckMesh( mesh ) checks a mesh for self-consistency.
    		*/

    		TESSmesh.prototype = {

    			/* MakeEdge creates a new pair of half-edges which form their own loop.
    			* No vertex or face structures are allocated, but these must be assigned
    			* before the current edge operation is completed.
    			*/
    			//static TESShalfEdge *MakeEdge( TESSmesh* mesh, TESShalfEdge *eNext )
    			makeEdge_: function(eNext) {
    				var e = new TESShalfEdge(0);
    				var eSym = new TESShalfEdge(1);

    				/* Make sure eNext points to the first edge of the edge pair */
    				if( eNext.Sym.side < eNext.side ) { eNext = eNext.Sym; }

    				/* Insert in circular doubly-linked list before eNext.
    				* Note that the prev pointer is stored in Sym->next.
    				*/
    				var ePrev = eNext.Sym.next;
    				eSym.next = ePrev;
    				ePrev.Sym.next = e;
    				e.next = eNext;
    				eNext.Sym.next = eSym;

    				e.Sym = eSym;
    				e.Onext = e;
    				e.Lnext = eSym;
    				e.Org = null;
    				e.Lface = null;
    				e.winding = 0;
    				e.activeRegion = null;

    				eSym.Sym = e;
    				eSym.Onext = eSym;
    				eSym.Lnext = e;
    				eSym.Org = null;
    				eSym.Lface = null;
    				eSym.winding = 0;
    				eSym.activeRegion = null;

    				return e;
    			},

    			/* Splice( a, b ) is best described by the Guibas/Stolfi paper or the
    			* CS348a notes (see mesh.h).  Basically it modifies the mesh so that
    			* a->Onext and b->Onext are exchanged.  This can have various effects
    			* depending on whether a and b belong to different face or vertex rings.
    			* For more explanation see tessMeshSplice() below.
    			*/
    			// static void Splice( TESShalfEdge *a, TESShalfEdge *b )
    			splice_: function(a, b) {
    				var aOnext = a.Onext;
    				var bOnext = b.Onext;
    				aOnext.Sym.Lnext = b;
    				bOnext.Sym.Lnext = a;
    				a.Onext = bOnext;
    				b.Onext = aOnext;
    			},

    			/* MakeVertex( newVertex, eOrig, vNext ) attaches a new vertex and makes it the
    			* origin of all edges in the vertex loop to which eOrig belongs. "vNext" gives
    			* a place to insert the new vertex in the global vertex list.  We insert
    			* the new vertex *before* vNext so that algorithms which walk the vertex
    			* list will not see the newly created vertices.
    			*/
    			//static void MakeVertex( TESSvertex *newVertex, TESShalfEdge *eOrig, TESSvertex *vNext )
    			makeVertex_: function(newVertex, eOrig, vNext) {
    				var vNew = newVertex;
    				assert(vNew !== null);

    				/* insert in circular doubly-linked list before vNext */
    				var vPrev = vNext.prev;
    				vNew.prev = vPrev;
    				vPrev.next = vNew;
    				vNew.next = vNext;
    				vNext.prev = vNew;

    				vNew.anEdge = eOrig;
    				/* leave coords, s, t undefined */

    				/* fix other edges on this vertex loop */
    				var e = eOrig;
    				do {
    					e.Org = vNew;
    					e = e.Onext;
    				} while(e !== eOrig);
    			},

    			/* MakeFace( newFace, eOrig, fNext ) attaches a new face and makes it the left
    			* face of all edges in the face loop to which eOrig belongs.  "fNext" gives
    			* a place to insert the new face in the global face list.  We insert
    			* the new face *before* fNext so that algorithms which walk the face
    			* list will not see the newly created faces.
    			*/
    			// static void MakeFace( TESSface *newFace, TESShalfEdge *eOrig, TESSface *fNext )
    			makeFace_: function(newFace, eOrig, fNext) {
    				var fNew = newFace;
    				assert(fNew !== null); 

    				/* insert in circular doubly-linked list before fNext */
    				var fPrev = fNext.prev;
    				fNew.prev = fPrev;
    				fPrev.next = fNew;
    				fNew.next = fNext;
    				fNext.prev = fNew;

    				fNew.anEdge = eOrig;
    				fNew.trail = null;
    				fNew.marked = false;

    				/* The new face is marked "inside" if the old one was.  This is a
    				* convenience for the common case where a face has been split in two.
    				*/
    				fNew.inside = fNext.inside;

    				/* fix other edges on this face loop */
    				var e = eOrig;
    				do {
    					e.Lface = fNew;
    					e = e.Lnext;
    				} while(e !== eOrig);
    			},

    			/* KillEdge( eDel ) destroys an edge (the half-edges eDel and eDel->Sym),
    			* and removes from the global edge list.
    			*/
    			//static void KillEdge( TESSmesh *mesh, TESShalfEdge *eDel )
    			killEdge_: function(eDel) {
    				/* Half-edges are allocated in pairs, see EdgePair above */
    				if( eDel.Sym.side < eDel.side ) { eDel = eDel.Sym; }

    				/* delete from circular doubly-linked list */
    				var eNext = eDel.next;
    				var ePrev = eDel.Sym.next;
    				eNext.Sym.next = ePrev;
    				ePrev.Sym.next = eNext;
    			},


    			/* KillVertex( vDel ) destroys a vertex and removes it from the global
    			* vertex list.  It updates the vertex loop to point to a given new vertex.
    			*/
    			//static void KillVertex( TESSmesh *mesh, TESSvertex *vDel, TESSvertex *newOrg )
    			killVertex_: function(vDel, newOrg) {
    				var eStart = vDel.anEdge;
    				/* change the origin of all affected edges */
    				var e = eStart;
    				do {
    					e.Org = newOrg;
    					e = e.Onext;
    				} while(e !== eStart);

    				/* delete from circular doubly-linked list */
    				var vPrev = vDel.prev;
    				var vNext = vDel.next;
    				vNext.prev = vPrev;
    				vPrev.next = vNext;
    			},

    			/* KillFace( fDel ) destroys a face and removes it from the global face
    			* list.  It updates the face loop to point to a given new face.
    			*/
    			//static void KillFace( TESSmesh *mesh, TESSface *fDel, TESSface *newLface )
    			killFace_: function(fDel, newLface) {
    				var eStart = fDel.anEdge;

    				/* change the left face of all affected edges */
    				var e = eStart;
    				do {
    					e.Lface = newLface;
    					e = e.Lnext;
    				} while(e !== eStart);

    				/* delete from circular doubly-linked list */
    				var fPrev = fDel.prev;
    				var fNext = fDel.next;
    				fNext.prev = fPrev;
    				fPrev.next = fNext;
    			},

    			/****************** Basic Edge Operations **********************/

    			/* tessMeshMakeEdge creates one edge, two vertices, and a loop (face).
    			* The loop consists of the two new half-edges.
    			*/
    			//TESShalfEdge *tessMeshMakeEdge( TESSmesh *mesh )
    			makeEdge: function() {
    				var newVertex1 = new TESSvertex();
    				var newVertex2 = new TESSvertex();
    				var newFace = new TESSface();
    				var e = this.makeEdge_( this.eHead);
    				this.makeVertex_( newVertex1, e, this.vHead );
    				this.makeVertex_( newVertex2, e.Sym, this.vHead );
    				this.makeFace_( newFace, e, this.fHead );
    				return e;
    			},

    			/* tessMeshSplice( eOrg, eDst ) is the basic operation for changing the
    			* mesh connectivity and topology.  It changes the mesh so that
    			*	eOrg->Onext <- OLD( eDst->Onext )
    			*	eDst->Onext <- OLD( eOrg->Onext )
    			* where OLD(...) means the value before the meshSplice operation.
    			*
    			* This can have two effects on the vertex structure:
    			*  - if eOrg->Org != eDst->Org, the two vertices are merged together
    			*  - if eOrg->Org == eDst->Org, the origin is split into two vertices
    			* In both cases, eDst->Org is changed and eOrg->Org is untouched.
    			*
    			* Similarly (and independently) for the face structure,
    			*  - if eOrg->Lface == eDst->Lface, one loop is split into two
    			*  - if eOrg->Lface != eDst->Lface, two distinct loops are joined into one
    			* In both cases, eDst->Lface is changed and eOrg->Lface is unaffected.
    			*
    			* Some special cases:
    			* If eDst == eOrg, the operation has no effect.
    			* If eDst == eOrg->Lnext, the new face will have a single edge.
    			* If eDst == eOrg->Lprev, the old face will have a single edge.
    			* If eDst == eOrg->Onext, the new vertex will have a single edge.
    			* If eDst == eOrg->Oprev, the old vertex will have a single edge.
    			*/
    			//int tessMeshSplice( TESSmesh* mesh, TESShalfEdge *eOrg, TESShalfEdge *eDst )
    			splice: function(eOrg, eDst) {
    				var joiningLoops = false;
    				var joiningVertices = false;

    				if( eOrg === eDst ) return;

    				if( eDst.Org !== eOrg.Org ) {
    					/* We are merging two disjoint vertices -- destroy eDst->Org */
    					joiningVertices = true;
    					this.killVertex_( eDst.Org, eOrg.Org );
    				}
    				if( eDst.Lface !== eOrg.Lface ) {
    					/* We are connecting two disjoint loops -- destroy eDst->Lface */
    					joiningLoops = true;
    					this.killFace_( eDst.Lface, eOrg.Lface );
    				}

    				/* Change the edge structure */
    				this.splice_( eDst, eOrg );

    				if( ! joiningVertices ) {
    					var newVertex = new TESSvertex();

    					/* We split one vertex into two -- the new vertex is eDst->Org.
    					* Make sure the old vertex points to a valid half-edge.
    					*/
    					this.makeVertex_( newVertex, eDst, eOrg.Org );
    					eOrg.Org.anEdge = eOrg;
    				}
    				if( ! joiningLoops ) {
    					var newFace = new TESSface();  

    					/* We split one loop into two -- the new loop is eDst->Lface.
    					* Make sure the old face points to a valid half-edge.
    					*/
    					this.makeFace_( newFace, eDst, eOrg.Lface );
    					eOrg.Lface.anEdge = eOrg;
    				}
    			},

    			/* tessMeshDelete( eDel ) removes the edge eDel.  There are several cases:
    			* if (eDel->Lface != eDel->Rface), we join two loops into one; the loop
    			* eDel->Lface is deleted.  Otherwise, we are splitting one loop into two;
    			* the newly created loop will contain eDel->Dst.  If the deletion of eDel
    			* would create isolated vertices, those are deleted as well.
    			*
    			* This function could be implemented as two calls to tessMeshSplice
    			* plus a few calls to memFree, but this would allocate and delete
    			* unnecessary vertices and faces.
    			*/
    			//int tessMeshDelete( TESSmesh *mesh, TESShalfEdge *eDel )
    			delete: function(eDel) {
    				var eDelSym = eDel.Sym;
    				var joiningLoops = false;

    				/* First step: disconnect the origin vertex eDel->Org.  We make all
    				* changes to get a consistent mesh in this "intermediate" state.
    				*/
    				if( eDel.Lface !== eDel.Rface ) {
    					/* We are joining two loops into one -- remove the left face */
    					joiningLoops = true;
    					this.killFace_( eDel.Lface, eDel.Rface );
    				}

    				if( eDel.Onext === eDel ) {
    					this.killVertex_( eDel.Org, null );
    				} else {
    					/* Make sure that eDel->Org and eDel->Rface point to valid half-edges */
    					eDel.Rface.anEdge = eDel.Oprev;
    					eDel.Org.anEdge = eDel.Onext;

    					this.splice_( eDel, eDel.Oprev );
    					if( ! joiningLoops ) {
    						var newFace = new TESSface();

    						/* We are splitting one loop into two -- create a new loop for eDel. */
    						this.makeFace_( newFace, eDel, eDel.Lface );
    					}
    				}

    				/* Claim: the mesh is now in a consistent state, except that eDel->Org
    				* may have been deleted.  Now we disconnect eDel->Dst.
    				*/
    				if( eDelSym.Onext === eDelSym ) {
    					this.killVertex_( eDelSym.Org, null );
    					this.killFace_( eDelSym.Lface, null );
    				} else {
    					/* Make sure that eDel->Dst and eDel->Lface point to valid half-edges */
    					eDel.Lface.anEdge = eDelSym.Oprev;
    					eDelSym.Org.anEdge = eDelSym.Onext;
    					this.splice_( eDelSym, eDelSym.Oprev );
    				}

    				/* Any isolated vertices or faces have already been freed. */
    				this.killEdge_( eDel );
    			},

    			/******************** Other Edge Operations **********************/

    			/* All these routines can be implemented with the basic edge
    			* operations above.  They are provided for convenience and efficiency.
    			*/


    			/* tessMeshAddEdgeVertex( eOrg ) creates a new edge eNew such that
    			* eNew == eOrg->Lnext, and eNew->Dst is a newly created vertex.
    			* eOrg and eNew will have the same left face.
    			*/
    			// TESShalfEdge *tessMeshAddEdgeVertex( TESSmesh *mesh, TESShalfEdge *eOrg );
    			addEdgeVertex: function(eOrg) {
    				var eNew = this.makeEdge_( eOrg );
    				var eNewSym = eNew.Sym;

    				/* Connect the new edge appropriately */
    				this.splice_( eNew, eOrg.Lnext );

    				/* Set the vertex and face information */
    				eNew.Org = eOrg.Dst;

    				var newVertex = new TESSvertex();
    				this.makeVertex_( newVertex, eNewSym, eNew.Org );

    				eNew.Lface = eNewSym.Lface = eOrg.Lface;

    				return eNew;
    			},


    			/* tessMeshSplitEdge( eOrg ) splits eOrg into two edges eOrg and eNew,
    			* such that eNew == eOrg->Lnext.  The new vertex is eOrg->Dst == eNew->Org.
    			* eOrg and eNew will have the same left face.
    			*/
    			// TESShalfEdge *tessMeshSplitEdge( TESSmesh *mesh, TESShalfEdge *eOrg );
    			splitEdge: function(eOrg, eDst) {
    				var tempHalfEdge = this.addEdgeVertex( eOrg );
    				var eNew = tempHalfEdge.Sym;

    				/* Disconnect eOrg from eOrg->Dst and connect it to eNew->Org */
    				this.splice_( eOrg.Sym, eOrg.Sym.Oprev );
    				this.splice_( eOrg.Sym, eNew );

    				/* Set the vertex and face information */
    				eOrg.Dst = eNew.Org;
    				eNew.Dst.anEdge = eNew.Sym;	/* may have pointed to eOrg->Sym */
    				eNew.Rface = eOrg.Rface;
    				eNew.winding = eOrg.winding;	/* copy old winding information */
    				eNew.Sym.winding = eOrg.Sym.winding;

    				return eNew;
    			},


    			/* tessMeshConnect( eOrg, eDst ) creates a new edge from eOrg->Dst
    			* to eDst->Org, and returns the corresponding half-edge eNew.
    			* If eOrg->Lface == eDst->Lface, this splits one loop into two,
    			* and the newly created loop is eNew->Lface.  Otherwise, two disjoint
    			* loops are merged into one, and the loop eDst->Lface is destroyed.
    			*
    			* If (eOrg == eDst), the new face will have only two edges.
    			* If (eOrg->Lnext == eDst), the old face is reduced to a single edge.
    			* If (eOrg->Lnext->Lnext == eDst), the old face is reduced to two edges.
    			*/

    			// TESShalfEdge *tessMeshConnect( TESSmesh *mesh, TESShalfEdge *eOrg, TESShalfEdge *eDst );
    			connect: function(eOrg, eDst) {
    				var joiningLoops = false;  
    				var eNew = this.makeEdge_( eOrg );
    				var eNewSym = eNew.Sym;

    				if( eDst.Lface !== eOrg.Lface ) {
    					/* We are connecting two disjoint loops -- destroy eDst->Lface */
    					joiningLoops = true;
    					this.killFace_( eDst.Lface, eOrg.Lface );
    				}

    				/* Connect the new edge appropriately */
    				this.splice_( eNew, eOrg.Lnext );
    				this.splice_( eNewSym, eDst );

    				/* Set the vertex and face information */
    				eNew.Org = eOrg.Dst;
    				eNewSym.Org = eDst.Org;
    				eNew.Lface = eNewSym.Lface = eOrg.Lface;

    				/* Make sure the old face points to a valid half-edge */
    				eOrg.Lface.anEdge = eNewSym;

    				if( ! joiningLoops ) {
    					var newFace = new TESSface();
    					/* We split one loop into two -- the new loop is eNew->Lface */
    					this.makeFace_( newFace, eNew, eOrg.Lface );
    				}
    				return eNew;
    			},

    			/* tessMeshZapFace( fZap ) destroys a face and removes it from the
    			* global face list.  All edges of fZap will have a NULL pointer as their
    			* left face.  Any edges which also have a NULL pointer as their right face
    			* are deleted entirely (along with any isolated vertices this produces).
    			* An entire mesh can be deleted by zapping its faces, one at a time,
    			* in any order.  Zapped faces cannot be used in further mesh operations!
    			*/
    			zapFace: function( fZap )
    			{
    				var eStart = fZap.anEdge;
    				var e, eNext, eSym;
    				var fPrev, fNext;

    				/* walk around face, deleting edges whose right face is also NULL */
    				eNext = eStart.Lnext;
    				do {
    					e = eNext;
    					eNext = e.Lnext;

    					e.Lface = null;
    					if( e.Rface === null ) {
    						/* delete the edge -- see TESSmeshDelete above */

    						if( e.Onext === e ) {
    							this.killVertex_( e.Org, null );
    						} else {
    							/* Make sure that e->Org points to a valid half-edge */
    							e.Org.anEdge = e.Onext;
    							this.splice_( e, e.Oprev );
    						}
    						eSym = e.Sym;
    						if( eSym.Onext === eSym ) {
    							this.killVertex_( eSym.Org, null );
    						} else {
    							/* Make sure that eSym->Org points to a valid half-edge */
    							eSym.Org.anEdge = eSym.Onext;
    							this.splice_( eSym, eSym.Oprev );
    						}
    						this.killEdge_( e );
    					}
    				} while( e != eStart );

    				/* delete from circular doubly-linked list */
    				fPrev = fZap.prev;
    				fNext = fZap.next;
    				fNext.prev = fPrev;
    				fPrev.next = fNext;
    			},

    			countFaceVerts_: function(f) {
    				var eCur = f.anEdge;
    				var n = 0;
    				do
    				{
    					n++;
    					eCur = eCur.Lnext;
    				}
    				while (eCur !== f.anEdge);
    				return n;
    			},

    			//int tessMeshMergeConvexFaces( TESSmesh *mesh, int maxVertsPerFace )
    			mergeConvexFaces: function(maxVertsPerFace) {
    				var f;
    				var eCur, eNext, eSym;
    				var vStart;
    				var curNv, symNv;

    				for( f = this.fHead.next; f !== this.fHead; f = f.next )
    				{
    					// Skip faces which are outside the result.
    					if( !f.inside )
    						continue;

    					eCur = f.anEdge;
    					vStart = eCur.Org;
    						
    					while (true)
    					{
    						eNext = eCur.Lnext;
    						eSym = eCur.Sym;

    						// Try to merge if the neighbour face is valid.
    						if( eSym && eSym.Lface && eSym.Lface.inside )
    						{
    							// Try to merge the neighbour faces if the resulting polygons
    							// does not exceed maximum number of vertices.
    							curNv = this.countFaceVerts_( f );
    							symNv = this.countFaceVerts_( eSym.Lface );
    							if( (curNv+symNv-2) <= maxVertsPerFace )
    							{
    								// Merge if the resulting poly is convex.
    								if( Geom.vertCCW( eCur.Lprev.Org, eCur.Org, eSym.Lnext.Lnext.Org ) &&
    									Geom.vertCCW( eSym.Lprev.Org, eSym.Org, eCur.Lnext.Lnext.Org ) )
    								{
    									eNext = eSym.Lnext;
    									this.delete( eSym );
    									eCur = null;
    									eSym = null;
    								}
    							}
    						}
    						
    						if( eCur && eCur.Lnext.Org === vStart )
    							break;
    							
    						// Continue to next edge.
    						eCur = eNext;
    					}
    				}
    				
    				return true;
    			},

    			/* tessMeshCheckMesh( mesh ) checks a mesh for self-consistency.
    			*/
    			check: function() {
    				var fHead = this.fHead;
    				var vHead = this.vHead;
    				var eHead = this.eHead;
    				var f, fPrev, v, vPrev, e, ePrev;

    				fPrev = fHead;
    				for( fPrev = fHead ; (f = fPrev.next) !== fHead; fPrev = f) {
    					assert( f.prev === fPrev );
    					e = f.anEdge;
    					do {
    						assert( e.Sym !== e );
    						assert( e.Sym.Sym === e );
    						assert( e.Lnext.Onext.Sym === e );
    						assert( e.Onext.Sym.Lnext === e );
    						assert( e.Lface === f );
    						e = e.Lnext;
    					} while( e !== f.anEdge );
    				}
    				assert( f.prev === fPrev && f.anEdge === null );

    				vPrev = vHead;
    				for( vPrev = vHead ; (v = vPrev.next) !== vHead; vPrev = v) {
    					assert( v.prev === vPrev );
    					e = v.anEdge;
    					do {
    						assert( e.Sym !== e );
    						assert( e.Sym.Sym === e );
    						assert( e.Lnext.Onext.Sym === e );
    						assert( e.Onext.Sym.Lnext === e );
    						assert( e.Org === v );
    						e = e.Onext;
    					} while( e !== v.anEdge );
    				}
    				assert( v.prev === vPrev && v.anEdge === null );

    				ePrev = eHead;
    				for( ePrev = eHead ; (e = ePrev.next) !== eHead; ePrev = e) {
    					assert( e.Sym.next === ePrev.Sym );
    					assert( e.Sym !== e );
    					assert( e.Sym.Sym === e );
    					assert( e.Org !== null );
    					assert( e.Dst !== null );
    					assert( e.Lnext.Onext.Sym === e );
    					assert( e.Onext.Sym.Lnext === e );
    				}
    				assert( e.Sym.next === ePrev.Sym
    					&& e.Sym === this.eHeadSym
    					&& e.Sym.Sym === e
    					&& e.Org === null && e.Dst === null
    					&& e.Lface === null && e.Rface === null );
    			}

    		};

    		var Geom = {};

    		Geom.vertEq = function(u,v) {
    			return (u.s === v.s && u.t === v.t);
    		};

    		/* Returns TRUE if u is lexicographically <= v. */
    		Geom.vertLeq = function(u,v) {
    			return ((u.s < v.s) || (u.s === v.s && u.t <= v.t));
    		};

    		/* Versions of VertLeq, EdgeSign, EdgeEval with s and t transposed. */
    		Geom.transLeq = function(u,v) {
    			return ((u.t < v.t) || (u.t === v.t && u.s <= v.s));
    		};

    		Geom.edgeGoesLeft = function(e) {
    			return Geom.vertLeq( e.Dst, e.Org );
    		};

    		Geom.edgeGoesRight = function(e) {
    			return Geom.vertLeq( e.Org, e.Dst );
    		};

    		Geom.vertL1dist = function(u,v) {
    			return (Math.abs(u.s - v.s) + Math.abs(u.t - v.t));
    		};

    		//TESSreal tesedgeEval( TESSvertex *u, TESSvertex *v, TESSvertex *w )
    		Geom.edgeEval = function( u, v, w ) {
    			/* Given three vertices u,v,w such that VertLeq(u,v) && VertLeq(v,w),
    			* evaluates the t-coord of the edge uw at the s-coord of the vertex v.
    			* Returns v->t - (uw)(v->s), ie. the signed distance from uw to v.
    			* If uw is vertical (and thus passes thru v), the result is zero.
    			*
    			* The calculation is extremely accurate and stable, even when v
    			* is very close to u or w.  In particular if we set v->t = 0 and
    			* let r be the negated result (this evaluates (uw)(v->s)), then
    			* r is guaranteed to satisfy MIN(u->t,w->t) <= r <= MAX(u->t,w->t).
    			*/
    			assert( Geom.vertLeq( u, v ) && Geom.vertLeq( v, w ));

    			var gapL = v.s - u.s;
    			var gapR = w.s - v.s;

    			if( gapL + gapR > 0.0 ) {
    				if( gapL < gapR ) {
    					return (v.t - u.t) + (u.t - w.t) * (gapL / (gapL + gapR));
    				} else {
    					return (v.t - w.t) + (w.t - u.t) * (gapR / (gapL + gapR));
    				}
    			}
    			/* vertical line */
    			return 0.0;
    		};

    		//TESSreal tesedgeSign( TESSvertex *u, TESSvertex *v, TESSvertex *w )
    		Geom.edgeSign = function( u, v, w ) {
    			/* Returns a number whose sign matches EdgeEval(u,v,w) but which
    			* is cheaper to evaluate.  Returns > 0, == 0 , or < 0
    			* as v is above, on, or below the edge uw.
    			*/
    			assert( Geom.vertLeq( u, v ) && Geom.vertLeq( v, w ));

    			var gapL = v.s - u.s;
    			var gapR = w.s - v.s;

    			if( gapL + gapR > 0.0 ) {
    				return (v.t - w.t) * gapL + (v.t - u.t) * gapR;
    			}
    			/* vertical line */
    			return 0.0;
    		};


    		/***********************************************************************
    		* Define versions of EdgeSign, EdgeEval with s and t transposed.
    		*/

    		//TESSreal testransEval( TESSvertex *u, TESSvertex *v, TESSvertex *w )
    		Geom.transEval = function( u, v, w ) {
    			/* Given three vertices u,v,w such that TransLeq(u,v) && TransLeq(v,w),
    			* evaluates the t-coord of the edge uw at the s-coord of the vertex v.
    			* Returns v->s - (uw)(v->t), ie. the signed distance from uw to v.
    			* If uw is vertical (and thus passes thru v), the result is zero.
    			*
    			* The calculation is extremely accurate and stable, even when v
    			* is very close to u or w.  In particular if we set v->s = 0 and
    			* let r be the negated result (this evaluates (uw)(v->t)), then
    			* r is guaranteed to satisfy MIN(u->s,w->s) <= r <= MAX(u->s,w->s).
    			*/
    			assert( Geom.transLeq( u, v ) && Geom.transLeq( v, w ));

    			var gapL = v.t - u.t;
    			var gapR = w.t - v.t;

    			if( gapL + gapR > 0.0 ) {
    				if( gapL < gapR ) {
    					return (v.s - u.s) + (u.s - w.s) * (gapL / (gapL + gapR));
    				} else {
    					return (v.s - w.s) + (w.s - u.s) * (gapR / (gapL + gapR));
    				}
    			}
    			/* vertical line */
    			return 0.0;
    		};

    		//TESSreal testransSign( TESSvertex *u, TESSvertex *v, TESSvertex *w )
    		Geom.transSign = function( u, v, w ) {
    			/* Returns a number whose sign matches TransEval(u,v,w) but which
    			* is cheaper to evaluate.  Returns > 0, == 0 , or < 0
    			* as v is above, on, or below the edge uw.
    			*/
    			assert( Geom.transLeq( u, v ) && Geom.transLeq( v, w ));

    			var gapL = v.t - u.t;
    			var gapR = w.t - v.t;

    			if( gapL + gapR > 0.0 ) {
    				return (v.s - w.s) * gapL + (v.s - u.s) * gapR;
    			}
    			/* vertical line */
    			return 0.0;
    		};


    		//int tesvertCCW( TESSvertex *u, TESSvertex *v, TESSvertex *w )
    		Geom.vertCCW = function( u, v, w ) {
    			/* For almost-degenerate situations, the results are not reliable.
    			* Unless the floating-point arithmetic can be performed without
    			* rounding errors, *any* implementation will give incorrect results
    			* on some degenerate inputs, so the client must have some way to
    			* handle this situation.
    			*/
    			return (u.s*(v.t - w.t) + v.s*(w.t - u.t) + w.s*(u.t - v.t)) >= 0.0;
    		};

    		/* Given parameters a,x,b,y returns the value (b*x+a*y)/(a+b),
    		* or (x+y)/2 if a==b==0.  It requires that a,b >= 0, and enforces
    		* this in the rare case that one argument is slightly negative.
    		* The implementation is extremely stable numerically.
    		* In particular it guarantees that the result r satisfies
    		* MIN(x,y) <= r <= MAX(x,y), and the results are very accurate
    		* even when a and b differ greatly in magnitude.
    		*/
    		Geom.interpolate = function(a,x,b,y) {
    			return (a = (a < 0) ? 0 : a, b = (b < 0) ? 0 : b, ((a <= b) ? ((b == 0) ? ((x+y) / 2) : (x + (y-x) * (a/(a+b)))) : (y + (x-y) * (b/(a+b)))));
    		};

    		/*
    		#ifndef FOR_TRITE_TEST_PROGRAM
    		#define Interpolate(a,x,b,y)	RealInterpolate(a,x,b,y)
    		#else

    		// Claim: the ONLY property the sweep algorithm relies on is that
    		// MIN(x,y) <= r <= MAX(x,y).  This is a nasty way to test that.
    		#include <stdlib.h>
    		extern int RandomInterpolate;

    		double Interpolate( double a, double x, double b, double y)
    		{
    			printf("*********************%d\n",RandomInterpolate);
    			if( RandomInterpolate ) {
    				a = 1.2 * drand48() - 0.1;
    				a = (a < 0) ? 0 : ((a > 1) ? 1 : a);
    				b = 1.0 - a;
    			}
    			return RealInterpolate(a,x,b,y);
    		}
    		#endif*/

    		Geom.intersect = function( o1, d1, o2, d2, v ) {
    			/* Given edges (o1,d1) and (o2,d2), compute their point of intersection.
    			* The computed point is guaranteed to lie in the intersection of the
    			* bounding rectangles defined by each edge.
    			*/
    			var z1, z2;
    			var t;

    			/* This is certainly not the most efficient way to find the intersection
    			* of two line segments, but it is very numerically stable.
    			*
    			* Strategy: find the two middle vertices in the VertLeq ordering,
    			* and interpolate the intersection s-value from these.  Then repeat
    			* using the TransLeq ordering to find the intersection t-value.
    			*/

    			if( ! Geom.vertLeq( o1, d1 )) { t = o1; o1 = d1; d1 = t; } //swap( o1, d1 ); }
    			if( ! Geom.vertLeq( o2, d2 )) { t = o2; o2 = d2; d2 = t; } //swap( o2, d2 ); }
    			if( ! Geom.vertLeq( o1, o2 )) { t = o1; o1 = o2; o2 = t; t = d1; d1 = d2; d2 = t; }//swap( o1, o2 ); swap( d1, d2 ); }

    			if( ! Geom.vertLeq( o2, d1 )) {
    				/* Technically, no intersection -- do our best */
    				v.s = (o2.s + d1.s) / 2;
    			} else if( Geom.vertLeq( d1, d2 )) {
    				/* Interpolate between o2 and d1 */
    				z1 = Geom.edgeEval( o1, o2, d1 );
    				z2 = Geom.edgeEval( o2, d1, d2 );
    				if( z1+z2 < 0 ) { z1 = -z1; z2 = -z2; }
    				v.s = Geom.interpolate( z1, o2.s, z2, d1.s );
    			} else {
    				/* Interpolate between o2 and d2 */
    				z1 = Geom.edgeSign( o1, o2, d1 );
    				z2 = -Geom.edgeSign( o1, d2, d1 );
    				if( z1+z2 < 0 ) { z1 = -z1; z2 = -z2; }
    				v.s = Geom.interpolate( z1, o2.s, z2, d2.s );
    			}

    			/* Now repeat the process for t */

    			if( ! Geom.transLeq( o1, d1 )) { t = o1; o1 = d1; d1 = t; } //swap( o1, d1 ); }
    			if( ! Geom.transLeq( o2, d2 )) { t = o2; o2 = d2; d2 = t; } //swap( o2, d2 ); }
    			if( ! Geom.transLeq( o1, o2 )) { t = o1; o1 = o2; o2 = t; t = d1; d1 = d2; d2 = t; } //swap( o1, o2 ); swap( d1, d2 ); }

    			if( ! Geom.transLeq( o2, d1 )) {
    				/* Technically, no intersection -- do our best */
    				v.t = (o2.t + d1.t) / 2;
    			} else if( Geom.transLeq( d1, d2 )) {
    				/* Interpolate between o2 and d1 */
    				z1 = Geom.transEval( o1, o2, d1 );
    				z2 = Geom.transEval( o2, d1, d2 );
    				if( z1+z2 < 0 ) { z1 = -z1; z2 = -z2; }
    				v.t = Geom.interpolate( z1, o2.t, z2, d1.t );
    			} else {
    				/* Interpolate between o2 and d2 */
    				z1 = Geom.transSign( o1, o2, d1 );
    				z2 = -Geom.transSign( o1, d2, d1 );
    				if( z1+z2 < 0 ) { z1 = -z1; z2 = -z2; }
    				v.t = Geom.interpolate( z1, o2.t, z2, d2.t );
    			}
    		};



    		function DictNode() {
    			this.key = null;
    			this.next = null;
    			this.prev = null;
    		}
    		function Dict(frame, leq) {
    			this.head = new DictNode();
    			this.head.next = this.head;
    			this.head.prev = this.head;
    			this.frame = frame;
    			this.leq = leq;
    		}
    		Dict.prototype = {
    			min: function() {
    				return this.head.next;
    			},

    			max: function() {
    				return this.head.prev;
    			},

    			insert: function(k) {
    				return this.insertBefore(this.head, k);
    			},

    			search: function(key) {
    				/* Search returns the node with the smallest key greater than or equal
    				* to the given key.  If there is no such key, returns a node whose
    				* key is NULL.  Similarly, Succ(Max(d)) has a NULL key, etc.
    				*/
    				var node = this.head;
    				do {
    					node = node.next;
    				} while( node.key !== null && ! this.leq(this.frame, key, node.key));

    				return node;
    			},

    			insertBefore: function(node, key) {
    				do {
    					node = node.prev;
    				} while( node.key !== null && ! this.leq(this.frame, node.key, key));

    				var newNode = new DictNode();
    				newNode.key = key;
    				newNode.next = node.next;
    				node.next.prev = newNode;
    				newNode.prev = node;
    				node.next = newNode;

    				return newNode;
    			},

    			delete: function(node) {
    				node.next.prev = node.prev;
    				node.prev.next = node.next;
    			}
    		};


    		function PQnode() {
    			this.handle = null;
    		}

    		function PQhandleElem() {
    			this.key = null;
    			this.node = null;
    		}

    		function PriorityQ(size, leq) {
    			this.size = 0;
    			this.max = size;

    			this.nodes = [];
    			this.nodes.length = size+1;
    			for (var i = 0; i < this.nodes.length; i++)
    				this.nodes[i] = new PQnode();

    			this.handles = [];
    			this.handles.length = size+1;
    			for (var i = 0; i < this.handles.length; i++)
    				this.handles[i] = new PQhandleElem();

    			this.initialized = false;
    			this.freeList = 0;
    			this.leq = leq;

    			this.nodes[1].handle = 1;	/* so that Minimum() returns NULL */
    			this.handles[1].key = null;
    		}
    		PriorityQ.prototype = {

    			floatDown_: function( curr )
    			{
    				var n = this.nodes;
    				var h = this.handles;
    				var hCurr, hChild;
    				var child;

    				hCurr = n[curr].handle;
    				for( ;; ) {
    					child = curr << 1;
    					if( child < this.size && this.leq( h[n[child+1].handle].key, h[n[child].handle].key )) {
    						++child;
    					}

    					assert(child <= this.max);

    					hChild = n[child].handle;
    					if( child > this.size || this.leq( h[hCurr].key, h[hChild].key )) {
    						n[curr].handle = hCurr;
    						h[hCurr].node = curr;
    						break;
    					}
    					n[curr].handle = hChild;
    					h[hChild].node = curr;
    					curr = child;
    				}
    			},

    			floatUp_: function( curr )
    			{
    				var n = this.nodes;
    				var h = this.handles;
    				var hCurr, hParent;
    				var parent;

    				hCurr = n[curr].handle;
    				for( ;; ) {
    					parent = curr >> 1;
    					hParent = n[parent].handle;
    					if( parent == 0 || this.leq( h[hParent].key, h[hCurr].key )) {
    						n[curr].handle = hCurr;
    						h[hCurr].node = curr;
    						break;
    					}
    					n[curr].handle = hParent;
    					h[hParent].node = curr;
    					curr = parent;
    				}
    			},

    			init: function() {
    				/* This method of building a heap is O(n), rather than O(n lg n). */
    				for( var i = this.size; i >= 1; --i ) {
    					this.floatDown_( i );
    				}
    				this.initialized = true;
    			},

    			min: function() {
    				return this.handles[this.nodes[1].handle].key;
    			},

    			isEmpty: function() {
    				this.size === 0;
    			},

    			/* really pqHeapInsert */
    			/* returns INV_HANDLE iff out of memory */
    			//PQhandle pqHeapInsert( TESSalloc* alloc, PriorityQHeap *pq, PQkey keyNew )
    			insert: function(keyNew)
    			{
    				var curr;
    				var free;

    				curr = ++this.size;
    				if( (curr*2) > this.max ) {
    					this.max *= 2;
    					var s;
    					s = this.nodes.length;
    					this.nodes.length = this.max+1;
    					for (var i = s; i < this.nodes.length; i++)
    						this.nodes[i] = new PQnode();

    					s = this.handles.length;
    					this.handles.length = this.max+1;
    					for (var i = s; i < this.handles.length; i++)
    						this.handles[i] = new PQhandleElem();
    				}

    				if( this.freeList === 0 ) {
    					free = curr;
    				} else {
    					free = this.freeList;
    					this.freeList = this.handles[free].node;
    				}

    				this.nodes[curr].handle = free;
    				this.handles[free].node = curr;
    				this.handles[free].key = keyNew;

    				if( this.initialized ) {
    					this.floatUp_( curr );
    				}
    				return free;
    			},

    			//PQkey pqHeapExtractMin( PriorityQHeap *pq )
    			extractMin: function() {
    				var n = this.nodes;
    				var h = this.handles;
    				var hMin = n[1].handle;
    				var min = h[hMin].key;

    				if( this.size > 0 ) {
    					n[1].handle = n[this.size].handle;
    					h[n[1].handle].node = 1;

    					h[hMin].key = null;
    					h[hMin].node = this.freeList;
    					this.freeList = hMin;

    					--this.size;
    					if( this.size > 0 ) {
    						this.floatDown_( 1 );
    					}
    				}
    				return min;
    			},

    			delete: function( hCurr ) {
    				var n = this.nodes;
    				var h = this.handles;
    				var curr;

    				assert( hCurr >= 1 && hCurr <= this.max && h[hCurr].key !== null );

    				curr = h[hCurr].node;
    				n[curr].handle = n[this.size].handle;
    				h[n[curr].handle].node = curr;

    				--this.size;
    				if( curr <= this.size ) {
    					if( curr <= 1 || this.leq( h[n[curr>>1].handle].key, h[n[curr].handle].key )) {
    						this.floatDown_( curr );
    					} else {
    						this.floatUp_( curr );
    					}
    				}
    				h[hCurr].key = null;
    				h[hCurr].node = this.freeList;
    				this.freeList = hCurr;
    			}
    		};


    		/* For each pair of adjacent edges crossing the sweep line, there is
    		* an ActiveRegion to represent the region between them.  The active
    		* regions are kept in sorted order in a dynamic dictionary.  As the
    		* sweep line crosses each vertex, we update the affected regions.
    		*/

    		function ActiveRegion() {
    			this.eUp = null;		/* upper edge, directed right to left */
    			this.nodeUp = null;	/* dictionary node corresponding to eUp */
    			this.windingNumber = 0;	/* used to determine which regions are
    									* inside the polygon */
    			this.inside = false;		/* is this region inside the polygon? */
    			this.sentinel = false;	/* marks fake edges at t = +/-infinity */
    			this.dirty = false;		/* marks regions where the upper or lower
    							* edge has changed, but we haven't checked
    							* whether they intersect yet */
    			this.fixUpperEdge = false;	/* marks temporary edges introduced when
    								* we process a "right vertex" (one without
    								* any edges leaving to the right) */
    		}
    		var Sweep = {};

    		Sweep.regionBelow = function(r) {
    			return r.nodeUp.prev.key;
    		};

    		Sweep.regionAbove = function(r) {
    			return r.nodeUp.next.key;
    		};

    		Sweep.debugEvent = function( tess ) {
    			// empty
    		};


    		/*
    		* Invariants for the Edge Dictionary.
    		* - each pair of adjacent edges e2=Succ(e1) satisfies EdgeLeq(e1,e2)
    		*   at any valid location of the sweep event
    		* - if EdgeLeq(e2,e1) as well (at any valid sweep event), then e1 and e2
    		*   share a common endpoint
    		* - for each e, e->Dst has been processed, but not e->Org
    		* - each edge e satisfies VertLeq(e->Dst,event) && VertLeq(event,e->Org)
    		*   where "event" is the current sweep line event.
    		* - no edge e has zero length
    		*
    		* Invariants for the Mesh (the processed portion).
    		* - the portion of the mesh left of the sweep line is a planar graph,
    		*   ie. there is *some* way to embed it in the plane
    		* - no processed edge has zero length
    		* - no two processed vertices have identical coordinates
    		* - each "inside" region is monotone, ie. can be broken into two chains
    		*   of monotonically increasing vertices according to VertLeq(v1,v2)
    		*   - a non-invariant: these chains may intersect (very slightly)
    		*
    		* Invariants for the Sweep.
    		* - if none of the edges incident to the event vertex have an activeRegion
    		*   (ie. none of these edges are in the edge dictionary), then the vertex
    		*   has only right-going edges.
    		* - if an edge is marked "fixUpperEdge" (it is a temporary edge introduced
    		*   by ConnectRightVertex), then it is the only right-going edge from
    		*   its associated vertex.  (This says that these edges exist only
    		*   when it is necessary.)
    		*/

    		/* When we merge two edges into one, we need to compute the combined
    		* winding of the new edge.
    		*/
    		Sweep.addWinding = function(eDst,eSrc) {
    			eDst.winding += eSrc.winding;
    			eDst.Sym.winding += eSrc.Sym.winding;
    		};


    		//static int EdgeLeq( TESStesselator *tess, ActiveRegion *reg1, ActiveRegion *reg2 )
    		Sweep.edgeLeq = function( tess, reg1, reg2 ) {
    			/*
    			* Both edges must be directed from right to left (this is the canonical
    			* direction for the upper edge of each region).
    			*
    			* The strategy is to evaluate a "t" value for each edge at the
    			* current sweep line position, given by tess->event.  The calculations
    			* are designed to be very stable, but of course they are not perfect.
    			*
    			* Special case: if both edge destinations are at the sweep event,
    			* we sort the edges by slope (they would otherwise compare equally).
    			*/
    			var ev = tess.event;
    			var t1, t2;

    			var e1 = reg1.eUp;
    			var e2 = reg2.eUp;

    			if( e1.Dst === ev ) {
    				if( e2.Dst === ev ) {
    					/* Two edges right of the sweep line which meet at the sweep event.
    					* Sort them by slope.
    					*/
    					if( Geom.vertLeq( e1.Org, e2.Org )) {
    						return Geom.edgeSign( e2.Dst, e1.Org, e2.Org ) <= 0;
    					}
    					return Geom.edgeSign( e1.Dst, e2.Org, e1.Org ) >= 0;
    				}
    				return Geom.edgeSign( e2.Dst, ev, e2.Org ) <= 0;
    			}
    			if( e2.Dst === ev ) {
    				return Geom.edgeSign( e1.Dst, ev, e1.Org ) >= 0;
    			}

    			/* General case - compute signed distance *from* e1, e2 to event */
    			var t1 = Geom.edgeEval( e1.Dst, ev, e1.Org );
    			var t2 = Geom.edgeEval( e2.Dst, ev, e2.Org );
    			return (t1 >= t2);
    		};


    		//static void DeleteRegion( TESStesselator *tess, ActiveRegion *reg )
    		Sweep.deleteRegion = function( tess, reg ) {
    			if( reg.fixUpperEdge ) {
    				/* It was created with zero winding number, so it better be
    				* deleted with zero winding number (ie. it better not get merged
    				* with a real edge).
    				*/
    				assert( reg.eUp.winding === 0 );
    			}
    			reg.eUp.activeRegion = null;
    			tess.dict.delete( reg.nodeUp );
    		};

    		//static int FixUpperEdge( TESStesselator *tess, ActiveRegion *reg, TESShalfEdge *newEdge )
    		Sweep.fixUpperEdge = function( tess, reg, newEdge ) {
    			/*
    			* Replace an upper edge which needs fixing (see ConnectRightVertex).
    			*/
    			assert( reg.fixUpperEdge );
    			tess.mesh.delete( reg.eUp );
    			reg.fixUpperEdge = false;
    			reg.eUp = newEdge;
    			newEdge.activeRegion = reg;
    		};

    		//static ActiveRegion *TopLeftRegion( TESStesselator *tess, ActiveRegion *reg )
    		Sweep.topLeftRegion = function( tess, reg ) {
    			var org = reg.eUp.Org;
    			var e;

    			/* Find the region above the uppermost edge with the same origin */
    			do {
    				reg = Sweep.regionAbove( reg );
    			} while( reg.eUp.Org === org );

    			/* If the edge above was a temporary edge introduced by ConnectRightVertex,
    			* now is the time to fix it.
    			*/
    			if( reg.fixUpperEdge ) {
    				e = tess.mesh.connect( Sweep.regionBelow(reg).eUp.Sym, reg.eUp.Lnext );
    				if (e === null) return null;
    				Sweep.fixUpperEdge( tess, reg, e );
    				reg = Sweep.regionAbove( reg );
    			}
    			return reg;
    		};

    		//static ActiveRegion *TopRightRegion( ActiveRegion *reg )
    		Sweep.topRightRegion = function( reg )
    		{
    			var dst = reg.eUp.Dst;
    			var reg = null;
    			/* Find the region above the uppermost edge with the same destination */
    			do {
    				reg = Sweep.regionAbove( reg );
    			} while( reg.eUp.Dst === dst );
    			return reg;
    		};

    		//static ActiveRegion *AddRegionBelow( TESStesselator *tess, ActiveRegion *regAbove, TESShalfEdge *eNewUp )
    		Sweep.addRegionBelow = function( tess, regAbove, eNewUp ) {
    			/*
    			* Add a new active region to the sweep line, *somewhere* below "regAbove"
    			* (according to where the new edge belongs in the sweep-line dictionary).
    			* The upper edge of the new region will be "eNewUp".
    			* Winding number and "inside" flag are not updated.
    			*/
    			var regNew = new ActiveRegion();
    			regNew.eUp = eNewUp;
    			regNew.nodeUp = tess.dict.insertBefore( regAbove.nodeUp, regNew );
    		//	if (regNew->nodeUp == NULL) longjmp(tess->env,1);
    			regNew.fixUpperEdge = false;
    			regNew.sentinel = false;
    			regNew.dirty = false;

    			eNewUp.activeRegion = regNew;
    			return regNew;
    		};

    		//static int IsWindingInside( TESStesselator *tess, int n )
    		Sweep.isWindingInside = function( tess, n ) {
    			switch( tess.windingRule ) {
    				case Tess2.WINDING_ODD:
    					return (n & 1) != 0;
    				case Tess2.WINDING_NONZERO:
    					return (n != 0);
    				case Tess2.WINDING_POSITIVE:
    					return (n > 0);
    				case Tess2.WINDING_NEGATIVE:
    					return (n < 0);
    				case Tess2.WINDING_ABS_GEQ_TWO:
    					return (n >= 2) || (n <= -2);
    			}
    			assert( false );
    			return false;
    		};

    		//static void ComputeWinding( TESStesselator *tess, ActiveRegion *reg )
    		Sweep.computeWinding = function( tess, reg ) {
    			reg.windingNumber = Sweep.regionAbove(reg).windingNumber + reg.eUp.winding;
    			reg.inside = Sweep.isWindingInside( tess, reg.windingNumber );
    		};


    		//static void FinishRegion( TESStesselator *tess, ActiveRegion *reg )
    		Sweep.finishRegion = function( tess, reg ) {
    			/*
    			* Delete a region from the sweep line.  This happens when the upper
    			* and lower chains of a region meet (at a vertex on the sweep line).
    			* The "inside" flag is copied to the appropriate mesh face (we could
    			* not do this before -- since the structure of the mesh is always
    			* changing, this face may not have even existed until now).
    			*/
    			var e = reg.eUp;
    			var f = e.Lface;

    			f.inside = reg.inside;
    			f.anEdge = e;   /* optimization for tessMeshTessellateMonoRegion() */
    			Sweep.deleteRegion( tess, reg );
    		};


    		//static TESShalfEdge *FinishLeftRegions( TESStesselator *tess, ActiveRegion *regFirst, ActiveRegion *regLast )
    		Sweep.finishLeftRegions = function( tess, regFirst, regLast ) {
    			/*
    			* We are given a vertex with one or more left-going edges.  All affected
    			* edges should be in the edge dictionary.  Starting at regFirst->eUp,
    			* we walk down deleting all regions where both edges have the same
    			* origin vOrg.  At the same time we copy the "inside" flag from the
    			* active region to the face, since at this point each face will belong
    			* to at most one region (this was not necessarily true until this point
    			* in the sweep).  The walk stops at the region above regLast; if regLast
    			* is NULL we walk as far as possible.  At the same time we relink the
    			* mesh if necessary, so that the ordering of edges around vOrg is the
    			* same as in the dictionary.
    			*/
    			var e, ePrev;
    			var reg = null;
    			var regPrev = regFirst;
    			var ePrev = regFirst.eUp;
    			while( regPrev !== regLast ) {
    				regPrev.fixUpperEdge = false;	/* placement was OK */
    				reg = Sweep.regionBelow( regPrev );
    				e = reg.eUp;
    				if( e.Org != ePrev.Org ) {
    					if( ! reg.fixUpperEdge ) {
    						/* Remove the last left-going edge.  Even though there are no further
    						* edges in the dictionary with this origin, there may be further
    						* such edges in the mesh (if we are adding left edges to a vertex
    						* that has already been processed).  Thus it is important to call
    						* FinishRegion rather than just DeleteRegion.
    						*/
    						Sweep.finishRegion( tess, regPrev );
    						break;
    					}
    					/* If the edge below was a temporary edge introduced by
    					* ConnectRightVertex, now is the time to fix it.
    					*/
    					e = tess.mesh.connect( ePrev.Lprev, e.Sym );
    		//			if (e == NULL) longjmp(tess->env,1);
    					Sweep.fixUpperEdge( tess, reg, e );
    				}

    				/* Relink edges so that ePrev->Onext == e */
    				if( ePrev.Onext !== e ) {
    					tess.mesh.splice( e.Oprev, e );
    					tess.mesh.splice( ePrev, e );
    				}
    				Sweep.finishRegion( tess, regPrev );	/* may change reg->eUp */
    				ePrev = reg.eUp;
    				regPrev = reg;
    			}
    			return ePrev;
    		};


    		//static void AddRightEdges( TESStesselator *tess, ActiveRegion *regUp, TESShalfEdge *eFirst, TESShalfEdge *eLast, TESShalfEdge *eTopLeft, int cleanUp )
    		Sweep.addRightEdges = function( tess, regUp, eFirst, eLast, eTopLeft, cleanUp ) {
    			/*
    			* Purpose: insert right-going edges into the edge dictionary, and update
    			* winding numbers and mesh connectivity appropriately.  All right-going
    			* edges share a common origin vOrg.  Edges are inserted CCW starting at
    			* eFirst; the last edge inserted is eLast->Oprev.  If vOrg has any
    			* left-going edges already processed, then eTopLeft must be the edge
    			* such that an imaginary upward vertical segment from vOrg would be
    			* contained between eTopLeft->Oprev and eTopLeft; otherwise eTopLeft
    			* should be NULL.
    			*/
    			var reg, regPrev;
    			var e, ePrev;
    			var firstTime = true;

    			/* Insert the new right-going edges in the dictionary */
    			e = eFirst;
    			do {
    				assert( Geom.vertLeq( e.Org, e.Dst ));
    				Sweep.addRegionBelow( tess, regUp, e.Sym );
    				e = e.Onext;
    			} while ( e !== eLast );

    			/* Walk *all* right-going edges from e->Org, in the dictionary order,
    			* updating the winding numbers of each region, and re-linking the mesh
    			* edges to match the dictionary ordering (if necessary).
    			*/
    			if( eTopLeft === null ) {
    				eTopLeft = Sweep.regionBelow( regUp ).eUp.Rprev;
    			}
    			regPrev = regUp;
    			ePrev = eTopLeft;
    			for( ;; ) {
    				reg = Sweep.regionBelow( regPrev );
    				e = reg.eUp.Sym;
    				if( e.Org !== ePrev.Org ) break;

    				if( e.Onext !== ePrev ) {
    					/* Unlink e from its current position, and relink below ePrev */
    					tess.mesh.splice( e.Oprev, e );
    					tess.mesh.splice( ePrev.Oprev, e );
    				}
    				/* Compute the winding number and "inside" flag for the new regions */
    				reg.windingNumber = regPrev.windingNumber - e.winding;
    				reg.inside = Sweep.isWindingInside( tess, reg.windingNumber );

    				/* Check for two outgoing edges with same slope -- process these
    				* before any intersection tests (see example in tessComputeInterior).
    				*/
    				regPrev.dirty = true;
    				if( ! firstTime && Sweep.checkForRightSplice( tess, regPrev )) {
    					Sweep.addWinding( e, ePrev );
    					Sweep.deleteRegion( tess, regPrev );
    					tess.mesh.delete( ePrev );
    				}
    				firstTime = false;
    				regPrev = reg;
    				ePrev = e;
    			}
    			regPrev.dirty = true;
    			assert( regPrev.windingNumber - e.winding === reg.windingNumber );

    			if( cleanUp ) {
    				/* Check for intersections between newly adjacent edges. */
    				Sweep.walkDirtyRegions( tess, regPrev );
    			}
    		};


    		//static void SpliceMergeVertices( TESStesselator *tess, TESShalfEdge *e1, TESShalfEdge *e2 )
    		Sweep.spliceMergeVertices = function( tess, e1, e2 ) {
    			/*
    			* Two vertices with idential coordinates are combined into one.
    			* e1->Org is kept, while e2->Org is discarded.
    			*/
    			tess.mesh.splice( e1, e2 ); 
    		};

    		//static void VertexWeights( TESSvertex *isect, TESSvertex *org, TESSvertex *dst, TESSreal *weights )
    		Sweep.vertexWeights = function( isect, org, dst ) {
    			/*
    			* Find some weights which describe how the intersection vertex is
    			* a linear combination of "org" and "dest".  Each of the two edges
    			* which generated "isect" is allocated 50% of the weight; each edge
    			* splits the weight between its org and dst according to the
    			* relative distance to "isect".
    			*/
    			var t1 = Geom.vertL1dist( org, isect );
    			var t2 = Geom.vertL1dist( dst, isect );
    			var w0 = 0.5 * t2 / (t1 + t2);
    			var w1 = 0.5 * t1 / (t1 + t2);
    			isect.coords[0] += w0*org.coords[0] + w1*dst.coords[0];
    			isect.coords[1] += w0*org.coords[1] + w1*dst.coords[1];
    			isect.coords[2] += w0*org.coords[2] + w1*dst.coords[2];
    		};


    		//static void GetIntersectData( TESStesselator *tess, TESSvertex *isect, TESSvertex *orgUp, TESSvertex *dstUp, TESSvertex *orgLo, TESSvertex *dstLo )
    		Sweep.getIntersectData = function( tess, isect, orgUp, dstUp, orgLo, dstLo ) {
    			 /*
    			 * We've computed a new intersection point, now we need a "data" pointer
    			 * from the user so that we can refer to this new vertex in the
    			 * rendering callbacks.
    			 */
    			isect.coords[0] = isect.coords[1] = isect.coords[2] = 0;
    			isect.idx = -1;
    			Sweep.vertexWeights( isect, orgUp, dstUp );
    			Sweep.vertexWeights( isect, orgLo, dstLo );
    		};

    		//static int CheckForRightSplice( TESStesselator *tess, ActiveRegion *regUp )
    		Sweep.checkForRightSplice = function( tess, regUp ) {
    			/*
    			* Check the upper and lower edge of "regUp", to make sure that the
    			* eUp->Org is above eLo, or eLo->Org is below eUp (depending on which
    			* origin is leftmost).
    			*
    			* The main purpose is to splice right-going edges with the same
    			* dest vertex and nearly identical slopes (ie. we can't distinguish
    			* the slopes numerically).  However the splicing can also help us
    			* to recover from numerical errors.  For example, suppose at one
    			* point we checked eUp and eLo, and decided that eUp->Org is barely
    			* above eLo.  Then later, we split eLo into two edges (eg. from
    			* a splice operation like this one).  This can change the result of
    			* our test so that now eUp->Org is incident to eLo, or barely below it.
    			* We must correct this condition to maintain the dictionary invariants.
    			*
    			* One possibility is to check these edges for intersection again
    			* (ie. CheckForIntersect).  This is what we do if possible.  However
    			* CheckForIntersect requires that tess->event lies between eUp and eLo,
    			* so that it has something to fall back on when the intersection
    			* calculation gives us an unusable answer.  So, for those cases where
    			* we can't check for intersection, this routine fixes the problem
    			* by just splicing the offending vertex into the other edge.
    			* This is a guaranteed solution, no matter how degenerate things get.
    			* Basically this is a combinatorial solution to a numerical problem.
    			*/
    			var regLo = Sweep.regionBelow(regUp);
    			var eUp = regUp.eUp;
    			var eLo = regLo.eUp;

    			if( Geom.vertLeq( eUp.Org, eLo.Org )) {
    				if( Geom.edgeSign( eLo.Dst, eUp.Org, eLo.Org ) > 0 ) return false;

    				/* eUp->Org appears to be below eLo */
    				if( ! Geom.vertEq( eUp.Org, eLo.Org )) {
    					/* Splice eUp->Org into eLo */
    					tess.mesh.splitEdge( eLo.Sym );
    					tess.mesh.splice( eUp, eLo.Oprev );
    					regUp.dirty = regLo.dirty = true;

    				} else if( eUp.Org !== eLo.Org ) {
    					/* merge the two vertices, discarding eUp->Org */
    					tess.pq.delete( eUp.Org.pqHandle );
    					Sweep.spliceMergeVertices( tess, eLo.Oprev, eUp );
    				}
    			} else {
    				if( Geom.edgeSign( eUp.Dst, eLo.Org, eUp.Org ) < 0 ) return false;

    				/* eLo->Org appears to be above eUp, so splice eLo->Org into eUp */
    				Sweep.regionAbove(regUp).dirty = regUp.dirty = true;
    				tess.mesh.splitEdge( eUp.Sym );
    				tess.mesh.splice( eLo.Oprev, eUp );
    			}
    			return true;
    		};

    		//static int CheckForLeftSplice( TESStesselator *tess, ActiveRegion *regUp )
    		Sweep.checkForLeftSplice = function( tess, regUp ) {
    			/*
    			* Check the upper and lower edge of "regUp", to make sure that the
    			* eUp->Dst is above eLo, or eLo->Dst is below eUp (depending on which
    			* destination is rightmost).
    			*
    			* Theoretically, this should always be true.  However, splitting an edge
    			* into two pieces can change the results of previous tests.  For example,
    			* suppose at one point we checked eUp and eLo, and decided that eUp->Dst
    			* is barely above eLo.  Then later, we split eLo into two edges (eg. from
    			* a splice operation like this one).  This can change the result of
    			* the test so that now eUp->Dst is incident to eLo, or barely below it.
    			* We must correct this condition to maintain the dictionary invariants
    			* (otherwise new edges might get inserted in the wrong place in the
    			* dictionary, and bad stuff will happen).
    			*
    			* We fix the problem by just splicing the offending vertex into the
    			* other edge.
    			*/
    			var regLo = Sweep.regionBelow(regUp);
    			var eUp = regUp.eUp;
    			var eLo = regLo.eUp;
    			var e;

    			assert( ! Geom.vertEq( eUp.Dst, eLo.Dst ));

    			if( Geom.vertLeq( eUp.Dst, eLo.Dst )) {
    				if( Geom.edgeSign( eUp.Dst, eLo.Dst, eUp.Org ) < 0 ) return false;

    				/* eLo->Dst is above eUp, so splice eLo->Dst into eUp */
    				Sweep.regionAbove(regUp).dirty = regUp.dirty = true;
    				e = tess.mesh.splitEdge( eUp );
    				tess.mesh.splice( eLo.Sym, e );
    				e.Lface.inside = regUp.inside;
    			} else {
    				if( Geom.edgeSign( eLo.Dst, eUp.Dst, eLo.Org ) > 0 ) return false;

    				/* eUp->Dst is below eLo, so splice eUp->Dst into eLo */
    				regUp.dirty = regLo.dirty = true;
    				e = tess.mesh.splitEdge( eLo );
    				tess.mesh.splice( eUp.Lnext, eLo.Sym );
    				e.Rface.inside = regUp.inside;
    			}
    			return true;
    		};


    		//static int CheckForIntersect( TESStesselator *tess, ActiveRegion *regUp )
    		Sweep.checkForIntersect = function( tess, regUp ) {
    			/*
    			* Check the upper and lower edges of the given region to see if
    			* they intersect.  If so, create the intersection and add it
    			* to the data structures.
    			*
    			* Returns TRUE if adding the new intersection resulted in a recursive
    			* call to AddRightEdges(); in this case all "dirty" regions have been
    			* checked for intersections, and possibly regUp has been deleted.
    			*/
    			var regLo = Sweep.regionBelow(regUp);
    			var eUp = regUp.eUp;
    			var eLo = regLo.eUp;
    			var orgUp = eUp.Org;
    			var orgLo = eLo.Org;
    			var dstUp = eUp.Dst;
    			var dstLo = eLo.Dst;
    			var tMinUp, tMaxLo;
    			var isect = new TESSvertex, orgMin;
    			var e;

    			assert( ! Geom.vertEq( dstLo, dstUp ));
    			assert( Geom.edgeSign( dstUp, tess.event, orgUp ) <= 0 );
    			assert( Geom.edgeSign( dstLo, tess.event, orgLo ) >= 0 );
    			assert( orgUp !== tess.event && orgLo !== tess.event );
    			assert( ! regUp.fixUpperEdge && ! regLo.fixUpperEdge );

    			if( orgUp === orgLo ) return false;	/* right endpoints are the same */

    			tMinUp = Math.min( orgUp.t, dstUp.t );
    			tMaxLo = Math.max( orgLo.t, dstLo.t );
    			if( tMinUp > tMaxLo ) return false;	/* t ranges do not overlap */

    			if( Geom.vertLeq( orgUp, orgLo )) {
    				if( Geom.edgeSign( dstLo, orgUp, orgLo ) > 0 ) return false;
    			} else {
    				if( Geom.edgeSign( dstUp, orgLo, orgUp ) < 0 ) return false;
    			}

    			/* At this point the edges intersect, at least marginally */
    			Sweep.debugEvent( tess );

    			Geom.intersect( dstUp, orgUp, dstLo, orgLo, isect );
    			/* The following properties are guaranteed: */
    			assert( Math.min( orgUp.t, dstUp.t ) <= isect.t );
    			assert( isect.t <= Math.max( orgLo.t, dstLo.t ));
    			assert( Math.min( dstLo.s, dstUp.s ) <= isect.s );
    			assert( isect.s <= Math.max( orgLo.s, orgUp.s ));

    			if( Geom.vertLeq( isect, tess.event )) {
    				/* The intersection point lies slightly to the left of the sweep line,
    				* so move it until it''s slightly to the right of the sweep line.
    				* (If we had perfect numerical precision, this would never happen
    				* in the first place).  The easiest and safest thing to do is
    				* replace the intersection by tess->event.
    				*/
    				isect.s = tess.event.s;
    				isect.t = tess.event.t;
    			}
    			/* Similarly, if the computed intersection lies to the right of the
    			* rightmost origin (which should rarely happen), it can cause
    			* unbelievable inefficiency on sufficiently degenerate inputs.
    			* (If you have the test program, try running test54.d with the
    			* "X zoom" option turned on).
    			*/
    			orgMin = Geom.vertLeq( orgUp, orgLo ) ? orgUp : orgLo;
    			if( Geom.vertLeq( orgMin, isect )) {
    				isect.s = orgMin.s;
    				isect.t = orgMin.t;
    			}

    			if( Geom.vertEq( isect, orgUp ) || Geom.vertEq( isect, orgLo )) {
    				/* Easy case -- intersection at one of the right endpoints */
    				Sweep.checkForRightSplice( tess, regUp );
    				return false;
    			}

    			if(    (! Geom.vertEq( dstUp, tess.event )
    				&& Geom.edgeSign( dstUp, tess.event, isect ) >= 0)
    				|| (! Geom.vertEq( dstLo, tess.event )
    				&& Geom.edgeSign( dstLo, tess.event, isect ) <= 0 ))
    			{
    				/* Very unusual -- the new upper or lower edge would pass on the
    				* wrong side of the sweep event, or through it.  This can happen
    				* due to very small numerical errors in the intersection calculation.
    				*/
    				if( dstLo === tess.event ) {
    					/* Splice dstLo into eUp, and process the new region(s) */
    					tess.mesh.splitEdge( eUp.Sym );
    					tess.mesh.splice( eLo.Sym, eUp );
    					regUp = Sweep.topLeftRegion( tess, regUp );
    		//			if (regUp == NULL) longjmp(tess->env,1);
    					eUp = Sweep.regionBelow(regUp).eUp;
    					Sweep.finishLeftRegions( tess, Sweep.regionBelow(regUp), regLo );
    					Sweep.addRightEdges( tess, regUp, eUp.Oprev, eUp, eUp, true );
    					return TRUE;
    				}
    				if( dstUp === tess.event ) {
    					/* Splice dstUp into eLo, and process the new region(s) */
    					tess.mesh.splitEdge( eLo.Sym );
    					tess.mesh.splice( eUp.Lnext, eLo.Oprev ); 
    					regLo = regUp;
    					regUp = Sweep.topRightRegion( regUp );
    					e = Sweep.regionBelow(regUp).eUp.Rprev;
    					regLo.eUp = eLo.Oprev;
    					eLo = Sweep.finishLeftRegions( tess, regLo, null );
    					Sweep.addRightEdges( tess, regUp, eLo.Onext, eUp.Rprev, e, true );
    					return true;
    				}
    				/* Special case: called from ConnectRightVertex.  If either
    				* edge passes on the wrong side of tess->event, split it
    				* (and wait for ConnectRightVertex to splice it appropriately).
    				*/
    				if( Geom.edgeSign( dstUp, tess.event, isect ) >= 0 ) {
    					Sweep.regionAbove(regUp).dirty = regUp.dirty = true;
    					tess.mesh.splitEdge( eUp.Sym );
    					eUp.Org.s = tess.event.s;
    					eUp.Org.t = tess.event.t;
    				}
    				if( Geom.edgeSign( dstLo, tess.event, isect ) <= 0 ) {
    					regUp.dirty = regLo.dirty = true;
    					tess.mesh.splitEdge( eLo.Sym );
    					eLo.Org.s = tess.event.s;
    					eLo.Org.t = tess.event.t;
    				}
    				/* leave the rest for ConnectRightVertex */
    				return false;
    			}

    			/* General case -- split both edges, splice into new vertex.
    			* When we do the splice operation, the order of the arguments is
    			* arbitrary as far as correctness goes.  However, when the operation
    			* creates a new face, the work done is proportional to the size of
    			* the new face.  We expect the faces in the processed part of
    			* the mesh (ie. eUp->Lface) to be smaller than the faces in the
    			* unprocessed original contours (which will be eLo->Oprev->Lface).
    			*/
    			tess.mesh.splitEdge( eUp.Sym );
    			tess.mesh.splitEdge( eLo.Sym );
    			tess.mesh.splice( eLo.Oprev, eUp );
    			eUp.Org.s = isect.s;
    			eUp.Org.t = isect.t;
    			eUp.Org.pqHandle = tess.pq.insert( eUp.Org );
    			Sweep.getIntersectData( tess, eUp.Org, orgUp, dstUp, orgLo, dstLo );
    			Sweep.regionAbove(regUp).dirty = regUp.dirty = regLo.dirty = true;
    			return false;
    		};

    		//static void WalkDirtyRegions( TESStesselator *tess, ActiveRegion *regUp )
    		Sweep.walkDirtyRegions = function( tess, regUp ) {
    			/*
    			* When the upper or lower edge of any region changes, the region is
    			* marked "dirty".  This routine walks through all the dirty regions
    			* and makes sure that the dictionary invariants are satisfied
    			* (see the comments at the beginning of this file).  Of course
    			* new dirty regions can be created as we make changes to restore
    			* the invariants.
    			*/
    			var regLo = Sweep.regionBelow(regUp);
    			var eUp, eLo;

    			for( ;; ) {
    				/* Find the lowest dirty region (we walk from the bottom up). */
    				while( regLo.dirty ) {
    					regUp = regLo;
    					regLo = Sweep.regionBelow(regLo);
    				}
    				if( ! regUp.dirty ) {
    					regLo = regUp;
    					regUp = Sweep.regionAbove( regUp );
    					if( regUp == null || ! regUp.dirty ) {
    						/* We've walked all the dirty regions */
    						return;
    					}
    				}
    				regUp.dirty = false;
    				eUp = regUp.eUp;
    				eLo = regLo.eUp;

    				if( eUp.Dst !== eLo.Dst ) {
    					/* Check that the edge ordering is obeyed at the Dst vertices. */
    					if( Sweep.checkForLeftSplice( tess, regUp )) {

    						/* If the upper or lower edge was marked fixUpperEdge, then
    						* we no longer need it (since these edges are needed only for
    						* vertices which otherwise have no right-going edges).
    						*/
    						if( regLo.fixUpperEdge ) {
    							Sweep.deleteRegion( tess, regLo );
    							tess.mesh.delete( eLo );
    							regLo = Sweep.regionBelow( regUp );
    							eLo = regLo.eUp;
    						} else if( regUp.fixUpperEdge ) {
    							Sweep.deleteRegion( tess, regUp );
    							tess.mesh.delete( eUp );
    							regUp = Sweep.regionAbove( regLo );
    							eUp = regUp.eUp;
    						}
    					}
    				}
    				if( eUp.Org !== eLo.Org ) {
    					if(    eUp.Dst !== eLo.Dst
    						&& ! regUp.fixUpperEdge && ! regLo.fixUpperEdge
    						&& (eUp.Dst === tess.event || eLo.Dst === tess.event) )
    					{
    						/* When all else fails in CheckForIntersect(), it uses tess->event
    						* as the intersection location.  To make this possible, it requires
    						* that tess->event lie between the upper and lower edges, and also
    						* that neither of these is marked fixUpperEdge (since in the worst
    						* case it might splice one of these edges into tess->event, and
    						* violate the invariant that fixable edges are the only right-going
    						* edge from their associated vertex).
    						*/
    						if( Sweep.checkForIntersect( tess, regUp )) {
    							/* WalkDirtyRegions() was called recursively; we're done */
    							return;
    						}
    					} else {
    						/* Even though we can't use CheckForIntersect(), the Org vertices
    						* may violate the dictionary edge ordering.  Check and correct this.
    						*/
    						Sweep.checkForRightSplice( tess, regUp );
    					}
    				}
    				if( eUp.Org === eLo.Org && eUp.Dst === eLo.Dst ) {
    					/* A degenerate loop consisting of only two edges -- delete it. */
    					Sweep.addWinding( eLo, eUp );
    					Sweep.deleteRegion( tess, regUp );
    					tess.mesh.delete( eUp );
    					regUp = Sweep.regionAbove( regLo );
    				}
    			}
    		};


    		//static void ConnectRightVertex( TESStesselator *tess, ActiveRegion *regUp, TESShalfEdge *eBottomLeft )
    		Sweep.connectRightVertex = function( tess, regUp, eBottomLeft ) {
    			/*
    			* Purpose: connect a "right" vertex vEvent (one where all edges go left)
    			* to the unprocessed portion of the mesh.  Since there are no right-going
    			* edges, two regions (one above vEvent and one below) are being merged
    			* into one.  "regUp" is the upper of these two regions.
    			*
    			* There are two reasons for doing this (adding a right-going edge):
    			*  - if the two regions being merged are "inside", we must add an edge
    			*    to keep them separated (the combined region would not be monotone).
    			*  - in any case, we must leave some record of vEvent in the dictionary,
    			*    so that we can merge vEvent with features that we have not seen yet.
    			*    For example, maybe there is a vertical edge which passes just to
    			*    the right of vEvent; we would like to splice vEvent into this edge.
    			*
    			* However, we don't want to connect vEvent to just any vertex.  We don''t
    			* want the new edge to cross any other edges; otherwise we will create
    			* intersection vertices even when the input data had no self-intersections.
    			* (This is a bad thing; if the user's input data has no intersections,
    			* we don't want to generate any false intersections ourselves.)
    			*
    			* Our eventual goal is to connect vEvent to the leftmost unprocessed
    			* vertex of the combined region (the union of regUp and regLo).
    			* But because of unseen vertices with all right-going edges, and also
    			* new vertices which may be created by edge intersections, we don''t
    			* know where that leftmost unprocessed vertex is.  In the meantime, we
    			* connect vEvent to the closest vertex of either chain, and mark the region
    			* as "fixUpperEdge".  This flag says to delete and reconnect this edge
    			* to the next processed vertex on the boundary of the combined region.
    			* Quite possibly the vertex we connected to will turn out to be the
    			* closest one, in which case we won''t need to make any changes.
    			*/
    			var eNew;
    			var eTopLeft = eBottomLeft.Onext;
    			var regLo = Sweep.regionBelow(regUp);
    			var eUp = regUp.eUp;
    			var eLo = regLo.eUp;
    			var degenerate = false;

    			if( eUp.Dst !== eLo.Dst ) {
    				Sweep.checkForIntersect( tess, regUp );
    			}

    			/* Possible new degeneracies: upper or lower edge of regUp may pass
    			* through vEvent, or may coincide with new intersection vertex
    			*/
    			if( Geom.vertEq( eUp.Org, tess.event )) {
    				tess.mesh.splice( eTopLeft.Oprev, eUp );
    				regUp = Sweep.topLeftRegion( tess, regUp );
    				eTopLeft = Sweep.regionBelow( regUp ).eUp;
    				Sweep.finishLeftRegions( tess, Sweep.regionBelow(regUp), regLo );
    				degenerate = true;
    			}
    			if( Geom.vertEq( eLo.Org, tess.event )) {
    				tess.mesh.splice( eBottomLeft, eLo.Oprev );
    				eBottomLeft = Sweep.finishLeftRegions( tess, regLo, null );
    				degenerate = true;
    			}
    			if( degenerate ) {
    				Sweep.addRightEdges( tess, regUp, eBottomLeft.Onext, eTopLeft, eTopLeft, true );
    				return;
    			}

    			/* Non-degenerate situation -- need to add a temporary, fixable edge.
    			* Connect to the closer of eLo->Org, eUp->Org.
    			*/
    			if( Geom.vertLeq( eLo.Org, eUp.Org )) {
    				eNew = eLo.Oprev;
    			} else {
    				eNew = eUp;
    			}
    			eNew = tess.mesh.connect( eBottomLeft.Lprev, eNew );

    			/* Prevent cleanup, otherwise eNew might disappear before we've even
    			* had a chance to mark it as a temporary edge.
    			*/
    			Sweep.addRightEdges( tess, regUp, eNew, eNew.Onext, eNew.Onext, false );
    			eNew.Sym.activeRegion.fixUpperEdge = true;
    			Sweep.walkDirtyRegions( tess, regUp );
    		};

    		/* Because vertices at exactly the same location are merged together
    		* before we process the sweep event, some degenerate cases can't occur.
    		* However if someone eventually makes the modifications required to
    		* merge features which are close together, the cases below marked
    		* TOLERANCE_NONZERO will be useful.  They were debugged before the
    		* code to merge identical vertices in the main loop was added.
    		*/
    		//#define TOLERANCE_NONZERO	FALSE

    		//static void ConnectLeftDegenerate( TESStesselator *tess, ActiveRegion *regUp, TESSvertex *vEvent )
    		Sweep.connectLeftDegenerate = function( tess, regUp, vEvent ) {
    			/*
    			* The event vertex lies exacty on an already-processed edge or vertex.
    			* Adding the new vertex involves splicing it into the already-processed
    			* part of the mesh.
    			*/
    			var e, eTopLeft, eTopRight, eLast;
    			var reg;

    			e = regUp.eUp;
    			if( Geom.vertEq( e.Org, vEvent )) {
    				/* e->Org is an unprocessed vertex - just combine them, and wait
    				* for e->Org to be pulled from the queue
    				*/
    				assert( false /*TOLERANCE_NONZERO*/ );
    				Sweep.spliceMergeVertices( tess, e, vEvent.anEdge );
    				return;
    			}

    			if( ! Geom.vertEq( e.Dst, vEvent )) {
    				/* General case -- splice vEvent into edge e which passes through it */
    				tess.mesh.splitEdge( e.Sym );
    				if( regUp.fixUpperEdge ) {
    					/* This edge was fixable -- delete unused portion of original edge */
    					tess.mesh.delete( e.Onext );
    					regUp.fixUpperEdge = false;
    				}
    				tess.mesh.splice( vEvent.anEdge, e );
    				Sweep.sweepEvent( tess, vEvent );	/* recurse */
    				return;
    			}

    			/* vEvent coincides with e->Dst, which has already been processed.
    			* Splice in the additional right-going edges.
    			*/
    			assert( false /*TOLERANCE_NONZERO*/ );
    			regUp = Sweep.topRightRegion( regUp );
    			reg = Sweep.regionBelow( regUp );
    			eTopRight = reg.eUp.Sym;
    			eTopLeft = eLast = eTopRight.Onext;
    			if( reg.fixUpperEdge ) {
    				/* Here e->Dst has only a single fixable edge going right.
    				* We can delete it since now we have some real right-going edges.
    				*/
    				assert( eTopLeft !== eTopRight );   /* there are some left edges too */
    				Sweep.deleteRegion( tess, reg );
    				tess.mesh.delete( eTopRight );
    				eTopRight = eTopLeft.Oprev;
    			}
    			tess.mesh.splice( vEvent.anEdge, eTopRight );
    			if( ! Geom.edgeGoesLeft( eTopLeft )) {
    				/* e->Dst had no left-going edges -- indicate this to AddRightEdges() */
    				eTopLeft = null;
    			}
    			Sweep.addRightEdges( tess, regUp, eTopRight.Onext, eLast, eTopLeft, true );
    		};


    		//static void ConnectLeftVertex( TESStesselator *tess, TESSvertex *vEvent )
    		Sweep.connectLeftVertex = function( tess, vEvent ) {
    			/*
    			* Purpose: connect a "left" vertex (one where both edges go right)
    			* to the processed portion of the mesh.  Let R be the active region
    			* containing vEvent, and let U and L be the upper and lower edge
    			* chains of R.  There are two possibilities:
    			*
    			* - the normal case: split R into two regions, by connecting vEvent to
    			*   the rightmost vertex of U or L lying to the left of the sweep line
    			*
    			* - the degenerate case: if vEvent is close enough to U or L, we
    			*   merge vEvent into that edge chain.  The subcases are:
    			*	- merging with the rightmost vertex of U or L
    			*	- merging with the active edge of U or L
    			*	- merging with an already-processed portion of U or L
    			*/
    			var regUp, regLo, reg;
    			var eUp, eLo, eNew;
    			var tmp = new ActiveRegion();

    			/* assert( vEvent->anEdge->Onext->Onext == vEvent->anEdge ); */

    			/* Get a pointer to the active region containing vEvent */
    			tmp.eUp = vEvent.anEdge.Sym;
    			/* __GL_DICTLISTKEY */ /* tessDictListSearch */
    			regUp = tess.dict.search( tmp ).key;
    			regLo = Sweep.regionBelow( regUp );
    			if( !regLo ) {
    				// This may happen if the input polygon is coplanar.
    				return;
    			}
    			eUp = regUp.eUp;
    			eLo = regLo.eUp;

    			/* Try merging with U or L first */
    			if( Geom.edgeSign( eUp.Dst, vEvent, eUp.Org ) === 0.0 ) {
    				Sweep.connectLeftDegenerate( tess, regUp, vEvent );
    				return;
    			}

    			/* Connect vEvent to rightmost processed vertex of either chain.
    			* e->Dst is the vertex that we will connect to vEvent.
    			*/
    			reg = Geom.vertLeq( eLo.Dst, eUp.Dst ) ? regUp : regLo;

    			if( regUp.inside || reg.fixUpperEdge) {
    				if( reg === regUp ) {
    					eNew = tess.mesh.connect( vEvent.anEdge.Sym, eUp.Lnext );
    				} else {
    					var tempHalfEdge = tess.mesh.connect( eLo.Dnext, vEvent.anEdge);
    					eNew = tempHalfEdge.Sym;
    				}
    				if( reg.fixUpperEdge ) {
    					Sweep.fixUpperEdge( tess, reg, eNew );
    				} else {
    					Sweep.computeWinding( tess, Sweep.addRegionBelow( tess, regUp, eNew ));
    				}
    				Sweep.sweepEvent( tess, vEvent );
    			} else {
    				/* The new vertex is in a region which does not belong to the polygon.
    				* We don''t need to connect this vertex to the rest of the mesh.
    				*/
    				Sweep.addRightEdges( tess, regUp, vEvent.anEdge, vEvent.anEdge, null, true );
    			}
    		};


    		//static void SweepEvent( TESStesselator *tess, TESSvertex *vEvent )
    		Sweep.sweepEvent = function( tess, vEvent ) {
    			/*
    			* Does everything necessary when the sweep line crosses a vertex.
    			* Updates the mesh and the edge dictionary.
    			*/

    			tess.event = vEvent;		/* for access in EdgeLeq() */
    			Sweep.debugEvent( tess );

    			/* Check if this vertex is the right endpoint of an edge that is
    			* already in the dictionary.  In this case we don't need to waste
    			* time searching for the location to insert new edges.
    			*/
    			var e = vEvent.anEdge;
    			while( e.activeRegion === null ) {
    				e = e.Onext;
    				if( e == vEvent.anEdge ) {
    					/* All edges go right -- not incident to any processed edges */
    					Sweep.connectLeftVertex( tess, vEvent );
    					return;
    				}
    			}

    			/* Processing consists of two phases: first we "finish" all the
    			* active regions where both the upper and lower edges terminate
    			* at vEvent (ie. vEvent is closing off these regions).
    			* We mark these faces "inside" or "outside" the polygon according
    			* to their winding number, and delete the edges from the dictionary.
    			* This takes care of all the left-going edges from vEvent.
    			*/
    			var regUp = Sweep.topLeftRegion( tess, e.activeRegion );
    			assert( regUp !== null );
    		//	if (regUp == NULL) longjmp(tess->env,1);
    			var reg = Sweep.regionBelow( regUp );
    			var eTopLeft = reg.eUp;
    			var eBottomLeft = Sweep.finishLeftRegions( tess, reg, null );

    			/* Next we process all the right-going edges from vEvent.  This
    			* involves adding the edges to the dictionary, and creating the
    			* associated "active regions" which record information about the
    			* regions between adjacent dictionary edges.
    			*/
    			if( eBottomLeft.Onext === eTopLeft ) {
    				/* No right-going edges -- add a temporary "fixable" edge */
    				Sweep.connectRightVertex( tess, regUp, eBottomLeft );
    			} else {
    				Sweep.addRightEdges( tess, regUp, eBottomLeft.Onext, eTopLeft, eTopLeft, true );
    			}
    		};


    		/* Make the sentinel coordinates big enough that they will never be
    		* merged with real input features.
    		*/

    		//static void AddSentinel( TESStesselator *tess, TESSreal smin, TESSreal smax, TESSreal t )
    		Sweep.addSentinel = function( tess, smin, smax, t ) {
    			/*
    			* We add two sentinel edges above and below all other edges,
    			* to avoid special cases at the top and bottom.
    			*/
    			var reg = new ActiveRegion();
    			var e = tess.mesh.makeEdge();
    		//	if (e == NULL) longjmp(tess->env,1);

    			e.Org.s = smax;
    			e.Org.t = t;
    			e.Dst.s = smin;
    			e.Dst.t = t;
    			tess.event = e.Dst;		/* initialize it */

    			reg.eUp = e;
    			reg.windingNumber = 0;
    			reg.inside = false;
    			reg.fixUpperEdge = false;
    			reg.sentinel = true;
    			reg.dirty = false;
    			reg.nodeUp = tess.dict.insert( reg );
    		//	if (reg->nodeUp == NULL) longjmp(tess->env,1);
    		};


    		//static void InitEdgeDict( TESStesselator *tess )
    		Sweep.initEdgeDict = function( tess ) {
    			/*
    			* We maintain an ordering of edge intersections with the sweep line.
    			* This order is maintained in a dynamic dictionary.
    			*/
    			tess.dict = new Dict( tess, Sweep.edgeLeq );
    		//	if (tess->dict == NULL) longjmp(tess->env,1);

    			var w = (tess.bmax[0] - tess.bmin[0]);
    			var h = (tess.bmax[1] - tess.bmin[1]);

    			var smin = tess.bmin[0] - w;
    			var smax = tess.bmax[0] + w;
    			var tmin = tess.bmin[1] - h;
    			var tmax = tess.bmax[1] + h;

    			Sweep.addSentinel( tess, smin, smax, tmin );
    			Sweep.addSentinel( tess, smin, smax, tmax );
    		};


    		Sweep.doneEdgeDict = function( tess )
    		{
    			var reg;
    			var fixedEdges = 0;

    			while( (reg = tess.dict.min().key) !== null ) {
    				/*
    				* At the end of all processing, the dictionary should contain
    				* only the two sentinel edges, plus at most one "fixable" edge
    				* created by ConnectRightVertex().
    				*/
    				if( ! reg.sentinel ) {
    					assert( reg.fixUpperEdge );
    					assert( ++fixedEdges == 1 );
    				}
    				assert( reg.windingNumber == 0 );
    				Sweep.deleteRegion( tess, reg );
    				/*    tessMeshDelete( reg->eUp );*/
    			}
    		//	dictDeleteDict( &tess->alloc, tess->dict );
    		};


    		Sweep.removeDegenerateEdges = function( tess ) {
    			/*
    			* Remove zero-length edges, and contours with fewer than 3 vertices.
    			*/
    			var e, eNext, eLnext;
    			var eHead = tess.mesh.eHead;

    			/*LINTED*/
    			for( e = eHead.next; e !== eHead; e = eNext ) {
    				eNext = e.next;
    				eLnext = e.Lnext;

    				if( Geom.vertEq( e.Org, e.Dst ) && e.Lnext.Lnext !== e ) {
    					/* Zero-length edge, contour has at least 3 edges */
    					Sweep.spliceMergeVertices( tess, eLnext, e );	/* deletes e->Org */
    					tess.mesh.delete( e ); /* e is a self-loop */
    					e = eLnext;
    					eLnext = e.Lnext;
    				}
    				if( eLnext.Lnext === e ) {
    					/* Degenerate contour (one or two edges) */
    					if( eLnext !== e ) {
    						if( eLnext === eNext || eLnext === eNext.Sym ) { eNext = eNext.next; }
    						tess.mesh.delete( eLnext );
    					}
    					if( e === eNext || e === eNext.Sym ) { eNext = eNext.next; }
    					tess.mesh.delete( e );
    				}
    			}
    		};

    		Sweep.initPriorityQ = function( tess ) {
    			/*
    			* Insert all vertices into the priority queue which determines the
    			* order in which vertices cross the sweep line.
    			*/
    			var pq;
    			var v, vHead;
    			var vertexCount = 0;
    			
    			vHead = tess.mesh.vHead;
    			for( v = vHead.next; v !== vHead; v = v.next ) {
    				vertexCount++;
    			}
    			/* Make sure there is enough space for sentinels. */
    			vertexCount += 8; //MAX( 8, tess->alloc.extraVertices );
    			
    			pq = tess.pq = new PriorityQ( vertexCount, Geom.vertLeq );
    		//	if (pq == NULL) return 0;

    			vHead = tess.mesh.vHead;
    			for( v = vHead.next; v !== vHead; v = v.next ) {
    				v.pqHandle = pq.insert( v );
    		//		if (v.pqHandle == INV_HANDLE)
    		//			break;
    			}

    			if (v !== vHead) {
    				return false;
    			}

    			pq.init();

    			return true;
    		};


    		Sweep.donePriorityQ = function( tess ) {
    			tess.pq = null;
    		};


    		Sweep.removeDegenerateFaces = function( tess, mesh ) {
    			/*
    			* Delete any degenerate faces with only two edges.  WalkDirtyRegions()
    			* will catch almost all of these, but it won't catch degenerate faces
    			* produced by splice operations on already-processed edges.
    			* The two places this can happen are in FinishLeftRegions(), when
    			* we splice in a "temporary" edge produced by ConnectRightVertex(),
    			* and in CheckForLeftSplice(), where we splice already-processed
    			* edges to ensure that our dictionary invariants are not violated
    			* by numerical errors.
    			*
    			* In both these cases it is *very* dangerous to delete the offending
    			* edge at the time, since one of the routines further up the stack
    			* will sometimes be keeping a pointer to that edge.
    			*/
    			var f, fNext;
    			var e;

    			/*LINTED*/
    			for( f = mesh.fHead.next; f !== mesh.fHead; f = fNext ) {
    				fNext = f.next;
    				e = f.anEdge;
    				assert( e.Lnext !== e );

    				if( e.Lnext.Lnext === e ) {
    					/* A face with only two edges */
    					Sweep.addWinding( e.Onext, e );
    					tess.mesh.delete( e );
    				}
    			}
    			return true;
    		};

    		Sweep.computeInterior = function( tess ) {
    			/*
    			* tessComputeInterior( tess ) computes the planar arrangement specified
    			* by the given contours, and further subdivides this arrangement
    			* into regions.  Each region is marked "inside" if it belongs
    			* to the polygon, according to the rule given by tess->windingRule.
    			* Each interior region is guaranteed be monotone.
    			*/
    			var v, vNext;

    			/* Each vertex defines an event for our sweep line.  Start by inserting
    			* all the vertices in a priority queue.  Events are processed in
    			* lexicographic order, ie.
    			*
    			*	e1 < e2  iff  e1.x < e2.x || (e1.x == e2.x && e1.y < e2.y)
    			*/
    			Sweep.removeDegenerateEdges( tess );
    			if ( !Sweep.initPriorityQ( tess ) ) return false; /* if error */
    			Sweep.initEdgeDict( tess );

    			while( (v = tess.pq.extractMin()) !== null ) {
    				for( ;; ) {
    					vNext = tess.pq.min();
    					if( vNext === null || ! Geom.vertEq( vNext, v )) break;

    					/* Merge together all vertices at exactly the same location.
    					* This is more efficient than processing them one at a time,
    					* simplifies the code (see ConnectLeftDegenerate), and is also
    					* important for correct handling of certain degenerate cases.
    					* For example, suppose there are two identical edges A and B
    					* that belong to different contours (so without this code they would
    					* be processed by separate sweep events).  Suppose another edge C
    					* crosses A and B from above.  When A is processed, we split it
    					* at its intersection point with C.  However this also splits C,
    					* so when we insert B we may compute a slightly different
    					* intersection point.  This might leave two edges with a small
    					* gap between them.  This kind of error is especially obvious
    					* when using boundary extraction (TESS_BOUNDARY_ONLY).
    					*/
    					vNext = tess.pq.extractMin();
    					Sweep.spliceMergeVertices( tess, v.anEdge, vNext.anEdge );
    				}
    				Sweep.sweepEvent( tess, v );
    			}

    			/* Set tess->event for debugging purposes */
    			tess.event = tess.dict.min().key.eUp.Org;
    			Sweep.debugEvent( tess );
    			Sweep.doneEdgeDict( tess );
    			Sweep.donePriorityQ( tess );

    			if ( !Sweep.removeDegenerateFaces( tess, tess.mesh ) ) return false;
    			tess.mesh.check();

    			return true;
    		};


    		function Tesselator() {

    			/*** state needed for collecting the input data ***/
    			this.mesh = null;		/* stores the input contours, and eventually
    								the tessellation itself */

    			/*** state needed for projecting onto the sweep plane ***/

    			this.normal = [0.0, 0.0, 0.0];	/* user-specified normal (if provided) */
    			this.sUnit = [0.0, 0.0, 0.0];	/* unit vector in s-direction (debugging) */
    			this.tUnit = [0.0, 0.0, 0.0];	/* unit vector in t-direction (debugging) */

    			this.bmin = [0.0, 0.0];
    			this.bmax = [0.0, 0.0];

    			/*** state needed for the line sweep ***/
    			this.windingRule = Tess2.WINDING_ODD;	/* rule for determining polygon interior */

    			this.dict = null;		/* edge dictionary for sweep line */
    			this.pq = null;		/* priority queue of vertex events */
    			this.event = null;		/* current sweep event being processed */

    			this.vertexIndexCounter = 0;
    			
    			this.vertices = [];
    			this.vertexIndices = [];
    			this.vertexCount = 0;
    			this.elements = [];
    			this.elementCount = 0;
    		}
    		Tesselator.prototype = {

    			dot_: function(u, v) {
    				return (u[0]*v[0] + u[1]*v[1] + u[2]*v[2]);
    			},

    			normalize_: function( v ) {
    				var len = v[0]*v[0] + v[1]*v[1] + v[2]*v[2];
    				assert( len > 0.0 );
    				len = Math.sqrt( len );
    				v[0] /= len;
    				v[1] /= len;
    				v[2] /= len;
    			},

    			longAxis_: function( v ) {
    				var i = 0;
    				if( Math.abs(v[1]) > Math.abs(v[0]) ) { i = 1; }
    				if( Math.abs(v[2]) > Math.abs(v[i]) ) { i = 2; }
    				return i;
    			},

    			computeNormal_: function( norm )
    			{
    				var v, v1, v2;
    				var c, tLen2, maxLen2;
    				var maxVal = [0,0,0], minVal = [0,0,0], d1 = [0,0,0], d2 = [0,0,0], tNorm = [0,0,0];
    				var maxVert = [null,null,null], minVert = [null,null,null];
    				var vHead = this.mesh.vHead;
    				var i;

    				v = vHead.next;
    				for( i = 0; i < 3; ++i ) {
    					c = v.coords[i];
    					minVal[i] = c;
    					minVert[i] = v;
    					maxVal[i] = c;
    					maxVert[i] = v;
    				}

    				for( v = vHead.next; v !== vHead; v = v.next ) {
    					for( i = 0; i < 3; ++i ) {
    						c = v.coords[i];
    						if( c < minVal[i] ) { minVal[i] = c; minVert[i] = v; }
    						if( c > maxVal[i] ) { maxVal[i] = c; maxVert[i] = v; }
    					}
    				}

    				/* Find two vertices separated by at least 1/sqrt(3) of the maximum
    				* distance between any two vertices
    				*/
    				i = 0;
    				if( maxVal[1] - minVal[1] > maxVal[0] - minVal[0] ) { i = 1; }
    				if( maxVal[2] - minVal[2] > maxVal[i] - minVal[i] ) { i = 2; }
    				if( minVal[i] >= maxVal[i] ) {
    					/* All vertices are the same -- normal doesn't matter */
    					norm[0] = 0; norm[1] = 0; norm[2] = 1;
    					return;
    				}

    				/* Look for a third vertex which forms the triangle with maximum area
    				* (Length of normal == twice the triangle area)
    				*/
    				maxLen2 = 0;
    				v1 = minVert[i];
    				v2 = maxVert[i];
    				d1[0] = v1.coords[0] - v2.coords[0];
    				d1[1] = v1.coords[1] - v2.coords[1];
    				d1[2] = v1.coords[2] - v2.coords[2];
    				for( v = vHead.next; v !== vHead; v = v.next ) {
    					d2[0] = v.coords[0] - v2.coords[0];
    					d2[1] = v.coords[1] - v2.coords[1];
    					d2[2] = v.coords[2] - v2.coords[2];
    					tNorm[0] = d1[1]*d2[2] - d1[2]*d2[1];
    					tNorm[1] = d1[2]*d2[0] - d1[0]*d2[2];
    					tNorm[2] = d1[0]*d2[1] - d1[1]*d2[0];
    					tLen2 = tNorm[0]*tNorm[0] + tNorm[1]*tNorm[1] + tNorm[2]*tNorm[2];
    					if( tLen2 > maxLen2 ) {
    						maxLen2 = tLen2;
    						norm[0] = tNorm[0];
    						norm[1] = tNorm[1];
    						norm[2] = tNorm[2];
    					}
    				}

    				if( maxLen2 <= 0 ) {
    					/* All points lie on a single line -- any decent normal will do */
    					norm[0] = norm[1] = norm[2] = 0;
    					norm[this.longAxis_(d1)] = 1;
    				}
    			},

    			checkOrientation_: function() {
    				var area;
    				var f, fHead = this.mesh.fHead;
    				var v, vHead = this.mesh.vHead;
    				var e;

    				/* When we compute the normal automatically, we choose the orientation
    				* so that the the sum of the signed areas of all contours is non-negative.
    				*/
    				area = 0;
    				for( f = fHead.next; f !== fHead; f = f.next ) {
    					e = f.anEdge;
    					if( e.winding <= 0 ) continue;
    					do {
    						area += (e.Org.s - e.Dst.s) * (e.Org.t + e.Dst.t);
    						e = e.Lnext;
    					} while( e !== f.anEdge );
    				}
    				if( area < 0 ) {
    					/* Reverse the orientation by flipping all the t-coordinates */
    					for( v = vHead.next; v !== vHead; v = v.next ) {
    						v.t = - v.t;
    					}
    					this.tUnit[0] = - this.tUnit[0];
    					this.tUnit[1] = - this.tUnit[1];
    					this.tUnit[2] = - this.tUnit[2];
    				}
    			},

    		/*	#ifdef FOR_TRITE_TEST_PROGRAM
    			#include <stdlib.h>
    			extern int RandomSweep;
    			#define S_UNIT_X	(RandomSweep ? (2*drand48()-1) : 1.0)
    			#define S_UNIT_Y	(RandomSweep ? (2*drand48()-1) : 0.0)
    			#else
    			#if defined(SLANTED_SWEEP) */
    			/* The "feature merging" is not intended to be complete.  There are
    			* special cases where edges are nearly parallel to the sweep line
    			* which are not implemented.  The algorithm should still behave
    			* robustly (ie. produce a reasonable tesselation) in the presence
    			* of such edges, however it may miss features which could have been
    			* merged.  We could minimize this effect by choosing the sweep line
    			* direction to be something unusual (ie. not parallel to one of the
    			* coordinate axes).
    			*/
    		/*	#define S_UNIT_X	(TESSreal)0.50941539564955385	// Pre-normalized
    			#define S_UNIT_Y	(TESSreal)0.86052074622010633
    			#else
    			#define S_UNIT_X	(TESSreal)1.0
    			#define S_UNIT_Y	(TESSreal)0.0
    			#endif
    			#endif*/

    			/* Determine the polygon normal and project vertices onto the plane
    			* of the polygon.
    			*/
    			projectPolygon_: function() {
    				var v, vHead = this.mesh.vHead;
    				var norm = [0,0,0];
    				var sUnit, tUnit;
    				var i, first, computedNormal = false;

    				norm[0] = this.normal[0];
    				norm[1] = this.normal[1];
    				norm[2] = this.normal[2];
    				if( norm[0] === 0.0 && norm[1] === 0.0 && norm[2] === 0.0 ) {
    					this.computeNormal_( norm );
    					computedNormal = true;
    				}
    				sUnit = this.sUnit;
    				tUnit = this.tUnit;
    				i = this.longAxis_( norm );

    		/*	#if defined(FOR_TRITE_TEST_PROGRAM) || defined(TRUE_PROJECT)
    				// Choose the initial sUnit vector to be approximately perpendicular
    				// to the normal.
    				
    				Normalize( norm );

    				sUnit[i] = 0;
    				sUnit[(i+1)%3] = S_UNIT_X;
    				sUnit[(i+2)%3] = S_UNIT_Y;

    				// Now make it exactly perpendicular 
    				w = Dot( sUnit, norm );
    				sUnit[0] -= w * norm[0];
    				sUnit[1] -= w * norm[1];
    				sUnit[2] -= w * norm[2];
    				Normalize( sUnit );

    				// Choose tUnit so that (sUnit,tUnit,norm) form a right-handed frame 
    				tUnit[0] = norm[1]*sUnit[2] - norm[2]*sUnit[1];
    				tUnit[1] = norm[2]*sUnit[0] - norm[0]*sUnit[2];
    				tUnit[2] = norm[0]*sUnit[1] - norm[1]*sUnit[0];
    				Normalize( tUnit );
    			#else*/
    				/* Project perpendicular to a coordinate axis -- better numerically */
    				sUnit[i] = 0;
    				sUnit[(i+1)%3] = 1.0;
    				sUnit[(i+2)%3] = 0.0;

    				tUnit[i] = 0;
    				tUnit[(i+1)%3] = 0.0;
    				tUnit[(i+2)%3] = (norm[i] > 0) ? 1.0 : -1;
    		//	#endif

    				/* Project the vertices onto the sweep plane */
    				for( v = vHead.next; v !== vHead; v = v.next ) {
    					v.s = this.dot_( v.coords, sUnit );
    					v.t = this.dot_( v.coords, tUnit );
    				}
    				if( computedNormal ) {
    					this.checkOrientation_();
    				}

    				/* Compute ST bounds. */
    				first = true;
    				for( v = vHead.next; v !== vHead; v = v.next ) {
    					if (first) {
    						this.bmin[0] = this.bmax[0] = v.s;
    						this.bmin[1] = this.bmax[1] = v.t;
    						first = false;
    					} else {
    						if (v.s < this.bmin[0]) this.bmin[0] = v.s;
    						if (v.s > this.bmax[0]) this.bmax[0] = v.s;
    						if (v.t < this.bmin[1]) this.bmin[1] = v.t;
    						if (v.t > this.bmax[1]) this.bmax[1] = v.t;
    					}
    				}
    			},

    			addWinding_: function(eDst,eSrc) {
    				eDst.winding += eSrc.winding;
    				eDst.Sym.winding += eSrc.Sym.winding;
    			},
    			
    			/* tessMeshTessellateMonoRegion( face ) tessellates a monotone region
    			* (what else would it do??)  The region must consist of a single
    			* loop of half-edges (see mesh.h) oriented CCW.  "Monotone" in this
    			* case means that any vertical line intersects the interior of the
    			* region in a single interval.  
    			*
    			* Tessellation consists of adding interior edges (actually pairs of
    			* half-edges), to split the region into non-overlapping triangles.
    			*
    			* The basic idea is explained in Preparata and Shamos (which I don''t
    			* have handy right now), although their implementation is more
    			* complicated than this one.  The are two edge chains, an upper chain
    			* and a lower chain.  We process all vertices from both chains in order,
    			* from right to left.
    			*
    			* The algorithm ensures that the following invariant holds after each
    			* vertex is processed: the untessellated region consists of two
    			* chains, where one chain (say the upper) is a single edge, and
    			* the other chain is concave.  The left vertex of the single edge
    			* is always to the left of all vertices in the concave chain.
    			*
    			* Each step consists of adding the rightmost unprocessed vertex to one
    			* of the two chains, and forming a fan of triangles from the rightmost
    			* of two chain endpoints.  Determining whether we can add each triangle
    			* to the fan is a simple orientation test.  By making the fan as large
    			* as possible, we restore the invariant (check it yourself).
    			*/
    		//	int tessMeshTessellateMonoRegion( TESSmesh *mesh, TESSface *face )
    			tessellateMonoRegion_: function( mesh, face ) {
    				var up, lo;

    				/* All edges are oriented CCW around the boundary of the region.
    				* First, find the half-edge whose origin vertex is rightmost.
    				* Since the sweep goes from left to right, face->anEdge should
    				* be close to the edge we want.
    				*/
    				up = face.anEdge;
    				assert( up.Lnext !== up && up.Lnext.Lnext !== up );

    				for( ; Geom.vertLeq( up.Dst, up.Org ); up = up.Lprev )
    					;
    				for( ; Geom.vertLeq( up.Org, up.Dst ); up = up.Lnext )
    					;
    				lo = up.Lprev;

    				while( up.Lnext !== lo ) {
    					if( Geom.vertLeq( up.Dst, lo.Org )) {
    						/* up->Dst is on the left.  It is safe to form triangles from lo->Org.
    						* The EdgeGoesLeft test guarantees progress even when some triangles
    						* are CW, given that the upper and lower chains are truly monotone.
    						*/
    						while( lo.Lnext !== up && (Geom.edgeGoesLeft( lo.Lnext )
    							|| Geom.edgeSign( lo.Org, lo.Dst, lo.Lnext.Dst ) <= 0.0 )) {
    								var tempHalfEdge = mesh.connect( lo.Lnext, lo );
    								//if (tempHalfEdge == NULL) return 0;
    								lo = tempHalfEdge.Sym;
    						}
    						lo = lo.Lprev;
    					} else {
    						/* lo->Org is on the left.  We can make CCW triangles from up->Dst. */
    						while( lo.Lnext != up && (Geom.edgeGoesRight( up.Lprev )
    							|| Geom.edgeSign( up.Dst, up.Org, up.Lprev.Org ) >= 0.0 )) {
    								var tempHalfEdge = mesh.connect( up, up.Lprev );
    								//if (tempHalfEdge == NULL) return 0;
    								up = tempHalfEdge.Sym;
    						}
    						up = up.Lnext;
    					}
    				}

    				/* Now lo->Org == up->Dst == the leftmost vertex.  The remaining region
    				* can be tessellated in a fan from this leftmost vertex.
    				*/
    				assert( lo.Lnext !== up );
    				while( lo.Lnext.Lnext !== up ) {
    					var tempHalfEdge = mesh.connect( lo.Lnext, lo );
    					//if (tempHalfEdge == NULL) return 0;
    					lo = tempHalfEdge.Sym;
    				}

    				return true;
    			},


    			/* tessMeshTessellateInterior( mesh ) tessellates each region of
    			* the mesh which is marked "inside" the polygon.  Each such region
    			* must be monotone.
    			*/
    			//int tessMeshTessellateInterior( TESSmesh *mesh )
    			tessellateInterior_: function( mesh ) {
    				var f, next;

    				/*LINTED*/
    				for( f = mesh.fHead.next; f !== mesh.fHead; f = next ) {
    					/* Make sure we don''t try to tessellate the new triangles. */
    					next = f.next;
    					if( f.inside ) {
    						if ( !this.tessellateMonoRegion_( mesh, f ) ) return false;
    					}
    				}

    				return true;
    			},


    			/* tessMeshDiscardExterior( mesh ) zaps (ie. sets to NULL) all faces
    			* which are not marked "inside" the polygon.  Since further mesh operations
    			* on NULL faces are not allowed, the main purpose is to clean up the
    			* mesh so that exterior loops are not represented in the data structure.
    			*/
    			//void tessMeshDiscardExterior( TESSmesh *mesh )
    			discardExterior_: function( mesh ) {
    				var f, next;

    				/*LINTED*/
    				for( f = mesh.fHead.next; f !== mesh.fHead; f = next ) {
    					/* Since f will be destroyed, save its next pointer. */
    					next = f.next;
    					if( ! f.inside ) {
    						mesh.zapFace( f );
    					}
    				}
    			},

    			/* tessMeshSetWindingNumber( mesh, value, keepOnlyBoundary ) resets the
    			* winding numbers on all edges so that regions marked "inside" the
    			* polygon have a winding number of "value", and regions outside
    			* have a winding number of 0.
    			*
    			* If keepOnlyBoundary is TRUE, it also deletes all edges which do not
    			* separate an interior region from an exterior one.
    			*/
    		//	int tessMeshSetWindingNumber( TESSmesh *mesh, int value, int keepOnlyBoundary )
    			setWindingNumber_: function( mesh, value, keepOnlyBoundary ) {
    				var e, eNext;

    				for( e = mesh.eHead.next; e !== mesh.eHead; e = eNext ) {
    					eNext = e.next;
    					if( e.Rface.inside !== e.Lface.inside ) {

    						/* This is a boundary edge (one side is interior, one is exterior). */
    						e.winding = (e.Lface.inside) ? value : -value;
    					} else {

    						/* Both regions are interior, or both are exterior. */
    						if( ! keepOnlyBoundary ) {
    							e.winding = 0;
    						} else {
    							mesh.delete( e );
    						}
    					}
    				}
    			},

    			getNeighbourFace_: function(edge)
    			{
    				if (!edge.Rface)
    					return -1;
    				if (!edge.Rface.inside)
    					return -1;
    				return edge.Rface.n;
    			},

    			outputPolymesh_: function( mesh, elementType, polySize, vertexSize ) {
    				var v;
    				var f;
    				var edge;
    				var maxFaceCount = 0;
    				var maxVertexCount = 0;
    				var faceVerts, i;

    				// Assume that the input data is triangles now.
    				// Try to merge as many polygons as possible
    				if (polySize > 3)
    				{
    					mesh.mergeConvexFaces( polySize );
    				}

    				// Mark unused
    				for ( v = mesh.vHead.next; v !== mesh.vHead; v = v.next )
    					v.n = -1;

    				// Create unique IDs for all vertices and faces.
    				for ( f = mesh.fHead.next; f != mesh.fHead; f = f.next )
    				{
    					f.n = -1;
    					if( !f.inside ) continue;

    					edge = f.anEdge;
    					faceVerts = 0;
    					do
    					{
    						v = edge.Org;
    						if ( v.n === -1 )
    						{
    							v.n = maxVertexCount;
    							maxVertexCount++;
    						}
    						faceVerts++;
    						edge = edge.Lnext;
    					}
    					while (edge !== f.anEdge);
    					
    					assert( faceVerts <= polySize );

    					f.n = maxFaceCount;
    					++maxFaceCount;
    				}

    				this.elementCount = maxFaceCount;
    				if (elementType == Tess2.CONNECTED_POLYGONS)
    					maxFaceCount *= 2;
    		/*		tess.elements = (TESSindex*)tess->alloc.memalloc( tess->alloc.userData,
    																  sizeof(TESSindex) * maxFaceCount * polySize );
    				if (!tess->elements)
    				{
    					tess->outOfMemory = 1;
    					return;
    				}*/
    				this.elements = [];
    				this.elements.length = maxFaceCount * polySize;
    				
    				this.vertexCount = maxVertexCount;
    		/*		tess->vertices = (TESSreal*)tess->alloc.memalloc( tess->alloc.userData,
    																 sizeof(TESSreal) * tess->vertexCount * vertexSize );
    				if (!tess->vertices)
    				{
    					tess->outOfMemory = 1;
    					return;
    				}*/
    				this.vertices = [];
    				this.vertices.length = maxVertexCount * vertexSize;

    		/*		tess->vertexIndices = (TESSindex*)tess->alloc.memalloc( tess->alloc.userData,
    																	    sizeof(TESSindex) * tess->vertexCount );
    				if (!tess->vertexIndices)
    				{
    					tess->outOfMemory = 1;
    					return;
    				}*/
    				this.vertexIndices = [];
    				this.vertexIndices.length = maxVertexCount;

    				
    				// Output vertices.
    				for ( v = mesh.vHead.next; v !== mesh.vHead; v = v.next )
    				{
    					if ( v.n != -1 )
    					{
    						// Store coordinate
    						var idx = v.n * vertexSize;
    						this.vertices[idx+0] = v.coords[0];
    						this.vertices[idx+1] = v.coords[1];
    						if ( vertexSize > 2 )
    							this.vertices[idx+2] = v.coords[2];
    						// Store vertex index.
    						this.vertexIndices[v.n] = v.idx;
    					}
    				}

    				// Output indices.
    				var nel = 0;
    				for ( f = mesh.fHead.next; f !== mesh.fHead; f = f.next )
    				{
    					if ( !f.inside ) continue;
    					
    					// Store polygon
    					edge = f.anEdge;
    					faceVerts = 0;
    					do
    					{
    						v = edge.Org;
    						this.elements[nel++] = v.n;
    						faceVerts++;
    						edge = edge.Lnext;
    					}
    					while (edge !== f.anEdge);
    					// Fill unused.
    					for (i = faceVerts; i < polySize; ++i)
    						this.elements[nel++] = -1;

    					// Store polygon connectivity
    					if ( elementType == Tess2.CONNECTED_POLYGONS )
    					{
    						edge = f.anEdge;
    						do
    						{
    							this.elements[nel++] = this.getNeighbourFace_( edge );
    							edge = edge.Lnext;
    						}
    						while (edge !== f.anEdge);
    						// Fill unused.
    						for (i = faceVerts; i < polySize; ++i)
    							this.elements[nel++] = -1;
    					}
    				}
    			},

    		//	void OutputContours( TESStesselator *tess, TESSmesh *mesh, int vertexSize )
    			outputContours_: function( mesh, vertexSize ) {
    				var f;
    				var edge;
    				var start;
    				var startVert = 0;
    				var vertCount = 0;

    				this.vertexCount = 0;
    				this.elementCount = 0;

    				for ( f = mesh.fHead.next; f !== mesh.fHead; f = f.next )
    				{
    					if ( !f.inside ) continue;

    					start = edge = f.anEdge;
    					do
    					{
    						this.vertexCount++;
    						edge = edge.Lnext;
    					}
    					while ( edge !== start );

    					this.elementCount++;
    				}

    		/*		tess->elements = (TESSindex*)tess->alloc.memalloc( tess->alloc.userData,
    																  sizeof(TESSindex) * tess->elementCount * 2 );
    				if (!tess->elements)
    				{
    					tess->outOfMemory = 1;
    					return;
    				}*/
    				this.elements = [];
    				this.elements.length = this.elementCount * 2;
    				
    		/*		tess->vertices = (TESSreal*)tess->alloc.memalloc( tess->alloc.userData,
    																  sizeof(TESSreal) * tess->vertexCount * vertexSize );
    				if (!tess->vertices)
    				{
    					tess->outOfMemory = 1;
    					return;
    				}*/
    				this.vertices = [];
    				this.vertices.length = this.vertexCount * vertexSize;

    		/*		tess->vertexIndices = (TESSindex*)tess->alloc.memalloc( tess->alloc.userData,
    																	    sizeof(TESSindex) * tess->vertexCount );
    				if (!tess->vertexIndices)
    				{
    					tess->outOfMemory = 1;
    					return;
    				}*/
    				this.vertexIndices = [];
    				this.vertexIndices.length = this.vertexCount;

    				var nv = 0;
    				var nvi = 0;
    				var nel = 0;
    				startVert = 0;

    				for ( f = mesh.fHead.next; f !== mesh.fHead; f = f.next )
    				{
    					if ( !f.inside ) continue;

    					vertCount = 0;
    					start = edge = f.anEdge;
    					do
    					{
    						this.vertices[nv++] = edge.Org.coords[0];
    						this.vertices[nv++] = edge.Org.coords[1];
    						if ( vertexSize > 2 )
    							this.vertices[nv++] = edge.Org.coords[2];
    						this.vertexIndices[nvi++] = edge.Org.idx;
    						vertCount++;
    						edge = edge.Lnext;
    					}
    					while ( edge !== start );

    					this.elements[nel++] = startVert;
    					this.elements[nel++] = vertCount;

    					startVert += vertCount;
    				}
    			},

    			addContour: function( size, vertices )
    			{
    				var e;
    				var i;

    				if ( this.mesh === null )
    				  	this.mesh = new TESSmesh();
    		/*	 	if ( tess->mesh == NULL ) {
    					tess->outOfMemory = 1;
    					return;
    				}*/

    				if ( size < 2 )
    					size = 2;
    				if ( size > 3 )
    					size = 3;

    				e = null;

    				for( i = 0; i < vertices.length; i += size )
    				{
    					if( e == null ) {
    						/* Make a self-loop (one vertex, one edge). */
    						e = this.mesh.makeEdge();
    		/*				if ( e == NULL ) {
    							tess->outOfMemory = 1;
    							return;
    						}*/
    						this.mesh.splice( e, e.Sym );
    					} else {
    						/* Create a new vertex and edge which immediately follow e
    						* in the ordering around the left face.
    						*/
    						this.mesh.splitEdge( e );
    						e = e.Lnext;
    					}

    					/* The new vertex is now e->Org. */
    					e.Org.coords[0] = vertices[i+0];
    					e.Org.coords[1] = vertices[i+1];
    					if ( size > 2 )
    						e.Org.coords[2] = vertices[i+2];
    					else
    						e.Org.coords[2] = 0.0;
    					/* Store the insertion number so that the vertex can be later recognized. */
    					e.Org.idx = this.vertexIndexCounter++;

    					/* The winding of an edge says how the winding number changes as we
    					* cross from the edge''s right face to its left face.  We add the
    					* vertices in such an order that a CCW contour will add +1 to
    					* the winding number of the region inside the contour.
    					*/
    					e.winding = 1;
    					e.Sym.winding = -1;
    				}
    			},

    		//	int tessTesselate( TESStesselator *tess, int windingRule, int elementType, int polySize, int vertexSize, const TESSreal* normal )
    			tesselate: function( windingRule, elementType, polySize, vertexSize, normal ) {
    				this.vertices = [];
    				this.elements = [];
    				this.vertexIndices = [];

    				this.vertexIndexCounter = 0;
    				
    				if (normal)
    				{
    					this.normal[0] = normal[0];
    					this.normal[1] = normal[1];
    					this.normal[2] = normal[2];
    				}

    				this.windingRule = windingRule;

    				if (vertexSize < 2)
    					vertexSize = 2;
    				if (vertexSize > 3)
    					vertexSize = 3;

    		/*		if (setjmp(tess->env) != 0) { 
    					// come back here if out of memory
    					return 0;
    				}*/

    				if (!this.mesh)
    				{
    					return false;
    				}

    				/* Determine the polygon normal and project vertices onto the plane
    				* of the polygon.
    				*/
    				this.projectPolygon_();

    				/* tessComputeInterior( tess ) computes the planar arrangement specified
    				* by the given contours, and further subdivides this arrangement
    				* into regions.  Each region is marked "inside" if it belongs
    				* to the polygon, according to the rule given by tess->windingRule.
    				* Each interior region is guaranteed be monotone.
    				*/
    				Sweep.computeInterior( this );

    				var mesh = this.mesh;

    				/* If the user wants only the boundary contours, we throw away all edges
    				* except those which separate the interior from the exterior.
    				* Otherwise we tessellate all the regions marked "inside".
    				*/
    				if (elementType == Tess2.BOUNDARY_CONTOURS) {
    					this.setWindingNumber_( mesh, 1, true );
    				} else {
    					this.tessellateInterior_( mesh ); 
    				}
    		//		if (rc == 0) longjmp(tess->env,1);  /* could've used a label */

    				mesh.check();

    				if (elementType == Tess2.BOUNDARY_CONTOURS) {
    					this.outputContours_( mesh, vertexSize );     /* output contours */
    				}
    				else
    				{
    					this.outputPolymesh_( mesh, elementType, polySize, vertexSize );     /* output polygons */
    				}

    	//			tess.mesh = null;

    				return true;
    			}
    		};
    	return tess2$1;
    }

    var tess2;
    var hasRequiredTess2;

    function requireTess2 () {
    	if (hasRequiredTess2) return tess2;
    	hasRequiredTess2 = 1;
    	tess2 = requireTess2$1();
    	return tess2;
    }

    var immutable;
    var hasRequiredImmutable;

    function requireImmutable () {
    	if (hasRequiredImmutable) return immutable;
    	hasRequiredImmutable = 1;
    	immutable = extend;

    	var hasOwnProperty = Object.prototype.hasOwnProperty;

    	function extend() {
    	    var target = {};

    	    for (var i = 0; i < arguments.length; i++) {
    	        var source = arguments[i];

    	        for (var key in source) {
    	            if (hasOwnProperty.call(source, key)) {
    	                target[key] = source[key];
    	            }
    	        }
    	    }

    	    return target
    	}
    	return immutable;
    }

    var triangulateContours;
    var hasRequiredTriangulateContours;

    function requireTriangulateContours () {
    	if (hasRequiredTriangulateContours) return triangulateContours;
    	hasRequiredTriangulateContours = 1;
    	var Tess2 = requireTess2();
    	var xtend = requireImmutable();

    	triangulateContours = function(contours, opt) {
    	    opt = opt||{};
    	    contours = contours.filter(function(c) {
    	        return c.length>0
    	    });
    	    
    	    if (contours.length === 0) {
    	        return { 
    	            positions: [],
    	            cells: []
    	        }
    	    }

    	    if (typeof opt.vertexSize !== 'number')
    	        opt.vertexSize = contours[0][0].length;

    	    //flatten for tess2.js
    	    contours = contours.map(function(c) {
    	        return c.reduce(function(a, b) {
    	            return a.concat(b)
    	        })
    	    });

    	    // Tesselate
    	    var res = Tess2.tesselate(xtend({
    	        contours: contours,
    	        windingRule: Tess2.WINDING_ODD,
    	        elementType: Tess2.POLYGONS,
    	        polySize: 3,
    	        vertexSize: 2
    	    }, opt));

    	    var positions = [];
    	    for (var i=0; i<res.vertices.length; i+=opt.vertexSize) {
    	        var pos = res.vertices.slice(i, i+opt.vertexSize);
    	        positions.push(pos);
    	    }
    	    
    	    var cells = [];
    	    for (i=0; i<res.elements.length; i+=3) {
    	        var a = res.elements[i],
    	            b = res.elements[i+1],
    	            c = res.elements[i+2];
    	        cells.push([a, b, c]);
    	    }

    	    //return a simplicial complex
    	    return {
    	        positions: positions,
    	        cells: cells
    	    }
    	};
    	return triangulateContours;
    }

    var triangulateContoursExports = requireTriangulateContours();
    var triangulate = /*@__PURE__*/getDefaultExportFromCjs(triangulateContoursExports);

    /**
     * A Map that holds at most `max` entries and drops the least recently used one
     * past that. Reading an entry counts as using it. `onEvict` is handed what is
     * dropped, for a cache whose values hold GPU memory.
     */
    class LruMap extends Map {
        max;
        onEvict;
        constructor(max, onEvict) {
            super();
            this.max = max;
            this.onEvict = onEvict;
        }
        get(key) {
            const value = super.get(key);
            if (value !== undefined) {
                // re-inserted, which keeps the map in least recently used order
                super.delete(key);
                super.set(key, value);
            }
            return value;
        }
        set(key, value) {
            super.delete(key);
            super.set(key, value);
            if (this.size > this.max) {
                const [oldest, dropped] = this.entries().next().value;
                super.delete(oldest);
                this.onEvict?.(dropped, oldest);
            }
            return this;
        }
    }
    /** Keeps `value` as one variant of `key`, such as one flatness a path is traced at. */
    function setVariant(cache, key, variant, value) {
        const variants = cache.get(key);
        if (variants) {
            variants.set(variant, value);
        }
        else {
            cache.set(key, new Map([[variant, value]]));
        }
    }

    const warned = new Set();
    /** Warns once per page for each key, since most of these would fire every frame. */
    function warnOnce(key, message) {
        if (!warned.has(key)) {
            warned.add(key);
            console.warn(message);
        }
    }

    const EMPTY = { lines: [], triangles: [] };
    /**
     * An svg path as polyline contours, flattening the curves and leaving the
     * straight runs alone.
     *
     * The commands come from vega's own path renderer, which is what the canvas
     * `path` mark draws with, so its reading of a path is ours. That matters
     * because it is not the specified one in three places, and a conforming parser
     * disagrees with it in each: `S` reflects the running control point whatever
     * came before, `T` does too while its relative form `t` checks, and an arc with
     * a zero radius is dropped where the spec draws a line to its end. Reading the
     * same commands is the only way the two renderers agree on those.
     *
     * A straight run keeps its two points at any flatness. The flattener this
     * replaced normalized every command to a cubic first, so a lineTo arrived as a
     * bezier with its control points on its own ends and was subdivided like any
     * other curve. The subdivision does not land on the ends, so the corners moved:
     * at a fine setting a step line's corner at (256.5, 65) came back as
     * (256.5, 64.93) and the join built there lost its tip.
     *
     * `subdivideStraight` gives back what that flattener produced, redundant points
     * and repeats and all, for the one caller that wants it: see the fallback in
     * geometryForPath.
     */
    function contoursOf(path, scale, subdivideStraight = false, scaleX = 1, scaleY = 1) {
        const out = [];
        let points = [];
        let px = 0;
        let py = 0;
        let sx = 0;
        let sy = 0;
        const flush = () => {
            if (points.length > 0) {
                out.push(points);
                points = [];
            }
        };
        const curve = (x1, y1, x2, y2, x, y) => {
            const from = points.length;
            bezier([px, py], [x1, y1], [x2, y2], [x, y], scale, points);
            // Both ends come back, so the point shared with the previous segment
            // repeats. The subdivided form keeps those on purpose, since it exists to
            // hand tess2 the shape the old flattener did, down to the repeats.
            if (!subdivideStraight && from > 0 && samePoint$1(points[from - 1], points[from])) {
                points.splice(from, 1);
            }
            px = x;
            py = y;
        };
        const line = (x, y) => {
            if (subdivideStraight) {
                curve(px, py, x, y, x, y);
                return;
            }
            pushPoint(points, px, py);
            pushPoint(points, x, y);
            px = x;
            py = y;
        };
        let commands;
        try {
            commands = vegaScenegraph.pathParse(path);
        }
        catch {
            warnOnce('path', '[vega-webgpu] An svg path could not be parsed and is not drawn.');
            return out;
        }
        vegaScenegraph.pathRender({
            moveTo(x, y) {
                flush();
                px = sx = x;
                py = sy = y;
            },
            lineTo: line,
            bezierCurveTo: curve,
            quadraticCurveTo(cx, cy, x, y) {
                // the cubic a quadratic raises to, which is what the old parser emitted
                curve(px + (2 / 3) * (cx - px), py + (2 / 3) * (cy - py), x + (2 / 3) * (cx - x), y + (2 / 3) * (cy - y), x, y);
            },
            closePath() {
                line(sx, sy);
            },
        }, commands, 0, 0, scaleX, scaleY);
        flush();
        return out;
    }
    function samePoint$1(a, b) {
        return a[0] === b[0] && a[1] === b[1];
    }
    function pushPoint(points, x, y) {
        const last = points[points.length - 1];
        if (!last || last[0] !== x || last[1] !== y) {
            points.push([x, y]);
        }
    }
    /** Triangulates contours, or null when tess2 cannot. */
    function tessellate(lines) {
        try {
            return triangulate(lines, { windingRule: WINDING_NONZERO });
        }
        catch {
            return null;
        }
    }
    // tess2's WINDING_NONZERO. canvas fills nonzero, and triangulate-contours asks
    // for even-odd, which leaves the middle of a self-intersecting path hollow.
    const WINDING_NONZERO = 1;
    /** What a contour about to be dashed is flattened at. See geometryForPath. */
    const DASH_FLATNESS = 1;
    const CURVE_FLATNESS = 4;
    /** Douglas-Peucker tolerance in pixels. At 1.0 a gentle curve visibly facets. */
    const CURVE_TOLERANCE = 0.1;
    /**
     * Triangulates an SVG path string into fill triangles and outline contours.
     * Results are cached on the context, keyed by the path string.
     *
     * `scale` is how finely a bezier is flattened. The default follows the curve
     * closely, which is what every consumer wants but one: `arc-shapes` goes from
     * 0.211% of pixels to 0.058%, `gradient-strokes` 0.161% to 0.054%,
     * `path-shapes` 0.034% to 0.005% and `trail` 0.016% to 0.009%.
     *
     * Four rather than more. It is where the gain flattens out, and past it the
     * extra vertices start costing: at 8 a nearly straight run picks up enough
     * near-collinear joints that one of them loses a pixel, which took `line-shapes`
     * at dpr 2 from worst channel 71 to 134 while its pixel count did not move.
     *
     * A dash is the exception and takes DASH_FLATNESS instead. Its runs are
     * measured along this polyline, so its length has to be the one canvas measures
     * rather than the curve's, and canvas is not measuring the curve: at the
     * default here `mark-dashes` goes 0.037% to 0.055% and worst channel 115 to
     * 206, and a dashed rounded border 0.010% to 0.034%.
     */
    function geometryForPath(context, path, scale, scaleX = 1, scaleY = 1) {
        if (!path) {
            return EMPTY;
        }
        // A chord's error is bounded in path units, so the same contour sits twice as
        // far from its own curve on a grid twice as fine. The flatness follows the
        // ratio, and a dash does not: it keeps the coarse contour whatever the ratio,
        // since it is measured along the polyline rather than drawn on it.
        const dpi = context._uniforms.dpi || 1;
        const flatness = scale ?? CURVE_FLATNESS * dpi;
        const variant = `${flatness}|${scaleX}|${scaleY}`;
        const cached = context._pathCache.get(path)?.get(variant);
        if (cached !== undefined) {
            return cached;
        }
        // get a list of polylines/contours from svg contents
        const flat = contoursOf(path, flatness, false, scaleX, scaleY);
        let lines = flat.map(contour => simplify(contour, CURVE_TOLERANCE));
        // Simplifying can nudge a contour into a self intersection, which tess2
        // reaches an undefined identifier on and throws. Dropping the shape there
        // loses it silently, and a county went missing off the choropleth that way,
        // so fall back to the contour as traced.
        let tri = tessellate(lines);
        if (tri === null) {
            lines = flat;
            tri = tessellate(lines);
        }
        if (tri === null) {
            // tess2 reaches an undefined identifier on outlines it does not like, and
            // an exact one is more likely to be among them than the same shape carrying
            // redundant points along its straight runs. A county of four contours went
            // missing off the choropleth that way: exact it throws at 19/9/18/137
            // points, and the flattener's own shape simplified to 19/9/18/143 gives 188
            // triangles. So the last try before giving up is that shape.
            lines = contoursOf(path, flatness, true, scaleX, scaleY).map(contour => simplify(contour, CURVE_TOLERANCE));
            tri = tessellate(lines);
        }
        for (let coarse = flatness / 2; tri === null && coarse >= flatness / 8; coarse /= 2) {
            // A coarser curve is a shape it takes where the fine one throws, and giving
            // up curve accuracy beats giving up the mark: the second ribbon of `trail`
            // went missing at dpr 2, where the flatness is twice what it is at dpr 1.
            lines = contoursOf(path, coarse, false, scaleX, scaleY).map(contour => simplify(contour, CURVE_TOLERANCE));
            tri = tessellate(lines);
        }
        if (tri === null) {
            tri = { positions: [], cells: [] };
            warnOnce('tessellation', '[vega-webgpu] A path could not be tessellated and is not drawn.');
        }
        const triangles = [];
        const { cells, positions } = tri;
        for (let ci = 0; ci < cells.length; ci++) {
            const cell = cells[ci];
            const p1 = positions[cell[0]];
            const p2 = positions[cell[1]];
            const p3 = positions[cell[2]];
            triangles.push(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]);
        }
        const geom = {
            lines,
            triangles,
            // geometryForItem caches on this, and the flatness and scale shape it too
            key: { path, variant },
        };
        setVariant(context._pathCache, path, variant, geom);
        return geom;
    }

    const x = (item) => item.x || 0;
    const y = (item) => item.y || 0;
    const xw = (item) => (item.x || 0) + (item.width || 0);
    const yh = (item) => (item.y || 0) + (item.height || 0);
    // vega's own trail accessor, which is `size` and not the item's extent
    const ts = (item) => item.size || 1;
    const cr = (item) => item.cornerRadius || 0;
    const pa = (item) => item.padAngle || 0;
    const def = (item) => item.defined !== false;
    // Every accessor, the way vega's own generator sets them. d3 defaults these to
    // fields on the datum, and vega puts no defaults on a scenegraph item, so an
    // arc that does not encode innerRadius reached d3 with it undefined: the
    // closing point came out NaN and cornerRadius went with it.
    const arcShape = d3_arc()
        .startAngle(item => item.startAngle || 0)
        .endAngle(item => item.endAngle || 0)
        .innerRadius(item => item.innerRadius || 0)
        .outerRadius(item => item.outerRadius || 0)
        .cornerRadius(cr)
        .padAngle(pa);
    const areavShape = d3_area().x(x).y1(y).y0(yh).defined(def);
    const areahShape = d3_area().y(y).x1(x).x0(xw).defined(def);
    const trailShape = vegaScenegraph.pathTrail().x(x).y(y).defined(def).size(ts);
    const lineShape = d3_line().x(x).y(y).defined(def);
    function arc$1(context, item, scale) {
        return geometryForPath(context, arcShape.context(null)(item) ?? '', scale);
    }
    function area$1(context, items, scale) {
        const item = items[0];
        const interp = item.interpolate || 'linear';
        if (interp === 'trail') {
            return trail$1(context, items, scale);
        }
        const path = (item.orient === 'horizontal' ? areahShape : areavShape)
            .curve(vegaScenegraph.pathCurves(interp, item.orient, item.tension))
            .context(null)(items);
        return geometryForPath(context, path ?? '', scale);
    }
    /**
     * Path geometry for a trail mark: one filled ribbon whose width follows each
     * point's `size`, which is what vega's own trail mark draws.
     */
    function trail$1(context, items, scale) {
        return geometryForPath(context, trailShape.context(null)(items) ?? '', scale);
    }
    /**
     * Path geometry for a line mark, honouring `interpolate`, `tension` and the
     * `defined` gaps. Used when the line is not a plain polyline.
     */
    function line$1(context, items) {
        const item = items[0];
        const curve = vegaScenegraph.pathCurves(item.interpolate || 'linear', item.orient, item.tension);
        return geometryForPath(context, lineShape.curve(curve).context(null)(items) ?? '');
    }
    /**
     * Runs the line generator straight into `sink`, so a caller that wants the
     * curve's own control points gets them without a path string in between.
     */
    function lineSpans(items, sink) {
        const item = items[0];
        const curve = vegaScenegraph.pathCurves(item.interpolate || 'linear', item.orient, item.tension);
        lineShape.curve(curve).context(sink)(items);
        lineShape.context(null);
    }
    function shape$1(context, item, scale) {
        const generator = (item.mark.shape ?? item.shape);
        return geometryForPath(context, generator.context(null)(item) ?? '', scale);
    }
    /**
     * Triangulated geometry for a vega symbol shape (square, cross, diamond,
     * triangle-*, arrow, wedge, stroke, or a custom SVG path) at the given size,
     * centered on the origin. `size` is the symbol area, matching the canvas
     * renderer's `pathSymbols` sizing.
     */
    function symbol$1(context, shapeName, size, scale) {
        const type = vegaScenegraph.pathSymbols(shapeName || 'circle');
        const path = Symbol(type, size).context(null)() ?? '';
        return geometryForPath(context, path, scale);
    }

    var asNumber;
    var hasRequiredAsNumber;

    function requireAsNumber () {
    	if (hasRequiredAsNumber) return asNumber;
    	hasRequiredAsNumber = 1;
    	asNumber = function numtype(num, def) {
    		return typeof num === 'number'
    			? num 
    			: (typeof def === 'number' ? def : 0)
    	};
    	return asNumber;
    }

    var copy_1;
    var hasRequiredCopy;

    function requireCopy () {
    	if (hasRequiredCopy) return copy_1;
    	hasRequiredCopy = 1;
    	copy_1 = copy;

    	/**
    	 * Copy the values from one vec2 to another
    	 *
    	 * @param {vec2} out the receiving vector
    	 * @param {vec2} a the source vector
    	 * @returns {vec2} out
    	 */
    	function copy(out, a) {
    	    out[0] = a[0];
    	    out[1] = a[1];
    	    return out
    	}
    	return copy_1;
    }

    var scaleAndAdd_1;
    var hasRequiredScaleAndAdd;

    function requireScaleAndAdd () {
    	if (hasRequiredScaleAndAdd) return scaleAndAdd_1;
    	hasRequiredScaleAndAdd = 1;
    	scaleAndAdd_1 = scaleAndAdd;

    	/**
    	 * Adds two vec2's after scaling the second operand by a scalar value
    	 *
    	 * @param {vec2} out the receiving vector
    	 * @param {vec2} a the first operand
    	 * @param {vec2} b the second operand
    	 * @param {Number} scale the amount to scale b by before adding
    	 * @returns {vec2} out
    	 */
    	function scaleAndAdd(out, a, b, scale) {
    	    out[0] = a[0] + (b[0] * scale);
    	    out[1] = a[1] + (b[1] * scale);
    	    return out
    	}
    	return scaleAndAdd_1;
    }

    var dot_1;
    var hasRequiredDot;

    function requireDot () {
    	if (hasRequiredDot) return dot_1;
    	hasRequiredDot = 1;
    	dot_1 = dot;

    	/**
    	 * Calculates the dot product of two vec2's
    	 *
    	 * @param {vec2} a the first operand
    	 * @param {vec2} b the second operand
    	 * @returns {Number} dot product of a and b
    	 */
    	function dot(a, b) {
    	    return a[0] * b[0] + a[1] * b[1]
    	}
    	return dot_1;
    }

    var vecutil;
    var hasRequiredVecutil;

    function requireVecutil () {
    	if (hasRequiredVecutil) return vecutil;
    	hasRequiredVecutil = 1;
    	function clone(arr) {
    	    return [arr[0], arr[1]]
    	}

    	function create() {
    	    return [0, 0]
    	}

    	vecutil = {
    	    create: create,
    	    clone: clone,
    	    copy: requireCopy(),
    	    scaleAndAdd: requireScaleAndAdd(),
    	    dot: requireDot()
    	};
    	return vecutil;
    }

    var polylineMiterUtil = {};

    var add_1;
    var hasRequiredAdd;

    function requireAdd () {
    	if (hasRequiredAdd) return add_1;
    	hasRequiredAdd = 1;
    	add_1 = add;

    	/**
    	 * Adds two vec2's
    	 *
    	 * @param {vec2} out the receiving vector
    	 * @param {vec2} a the first operand
    	 * @param {vec2} b the second operand
    	 * @returns {vec2} out
    	 */
    	function add(out, a, b) {
    	    out[0] = a[0] + b[0];
    	    out[1] = a[1] + b[1];
    	    return out
    	}
    	return add_1;
    }

    var set_1;
    var hasRequiredSet;

    function requireSet () {
    	if (hasRequiredSet) return set_1;
    	hasRequiredSet = 1;
    	set_1 = set;

    	/**
    	 * Set the components of a vec2 to the given values
    	 *
    	 * @param {vec2} out the receiving vector
    	 * @param {Number} x X component
    	 * @param {Number} y Y component
    	 * @returns {vec2} out
    	 */
    	function set(out, x, y) {
    	    out[0] = x;
    	    out[1] = y;
    	    return out
    	}
    	return set_1;
    }

    var normalize_1;
    var hasRequiredNormalize;

    function requireNormalize () {
    	if (hasRequiredNormalize) return normalize_1;
    	hasRequiredNormalize = 1;
    	normalize_1 = normalize;

    	/**
    	 * Normalize a vec2
    	 *
    	 * @param {vec2} out the receiving vector
    	 * @param {vec2} a vector to normalize
    	 * @returns {vec2} out
    	 */
    	function normalize(out, a) {
    	    var x = a[0],
    	        y = a[1];
    	    var len = x*x + y*y;
    	    if (len > 0) {
    	        //TODO: evaluate use of glm_invsqrt here?
    	        len = 1 / Math.sqrt(len);
    	        out[0] = a[0] * len;
    	        out[1] = a[1] * len;
    	    }
    	    return out
    	}
    	return normalize_1;
    }

    var subtract_1;
    var hasRequiredSubtract;

    function requireSubtract () {
    	if (hasRequiredSubtract) return subtract_1;
    	hasRequiredSubtract = 1;
    	subtract_1 = subtract;

    	/**
    	 * Subtracts vector b from vector a
    	 *
    	 * @param {vec2} out the receiving vector
    	 * @param {vec2} a the first operand
    	 * @param {vec2} b the second operand
    	 * @returns {vec2} out
    	 */
    	function subtract(out, a, b) {
    	    out[0] = a[0] - b[0];
    	    out[1] = a[1] - b[1];
    	    return out
    	}
    	return subtract_1;
    }

    var hasRequiredPolylineMiterUtil;

    function requirePolylineMiterUtil () {
    	if (hasRequiredPolylineMiterUtil) return polylineMiterUtil;
    	hasRequiredPolylineMiterUtil = 1;
    	var add = requireAdd();
    	var set = requireSet();
    	var normalize = requireNormalize();
    	var subtract = requireSubtract();
    	var dot = requireDot();

    	var tmp = [0, 0];

    	polylineMiterUtil.computeMiter = function computeMiter(tangent, miter, lineA, lineB, halfThick) {
    	    //get tangent line
    	    add(tangent, lineA, lineB);
    	    normalize(tangent, tangent);

    	    //get miter as a unit vector
    	    set(miter, -tangent[1], tangent[0]);
    	    set(tmp, -lineA[1], lineA[0]);

    	    //get the necessary length of our miter
    	    return halfThick / dot(miter, tmp)
    	};

    	polylineMiterUtil.normal = function normal(out, dir) {
    	    //get perpendicular
    	    set(out, -dir[1], dir[0]);
    	    return out
    	};

    	polylineMiterUtil.direction = function direction(out, a, b) {
    	    //get unit dir of two lines
    	    subtract(out, a, b);
    	    normalize(out, out);
    	    return out
    	};
    	return polylineMiterUtil;
    }

    var extrudePolyline;
    var hasRequiredExtrudePolyline;

    function requireExtrudePolyline () {
    	if (hasRequiredExtrudePolyline) return extrudePolyline;
    	hasRequiredExtrudePolyline = 1;
    	var number = requireAsNumber();
    	var vec = requireVecutil();

    	var tmp = vec.create();
    	var capEnd = vec.create();
    	var lineA = vec.create();
    	var lineB = vec.create();
    	var tangent = vec.create();
    	var miter = vec.create();

    	var util = requirePolylineMiterUtil();
    	var computeMiter = util.computeMiter,
    	    normal = util.normal,
    	    direction = util.direction;

    	function Stroke(opt) {
    	    if (!(this instanceof Stroke))
    	        return new Stroke(opt)
    	    opt = opt||{};
    	    this.miterLimit = number(opt.miterLimit, 10);
    	    this.thickness = number(opt.thickness, 1);
    	    this.join = opt.join || 'miter';
    	    this.cap = opt.cap || 'butt';
    	    this._normal = null;
    	    this._lastFlip = -1;
    	    this._started = false;
    	}

    	Stroke.prototype.mapThickness = function(point, i, points) {
    	    return this.thickness
    	};

    	Stroke.prototype.build = function(points) {
    	    var complex = {
    	        positions: [],
    	        cells: []
    	    };

    	    if (points.length <= 1)
    	        return complex

    	    var total = points.length;

    	    //clear flags
    	    this._lastFlip = -1;
    	    this._started = false;
    	    this._normal = null;

    	    //join each segment
    	    for (var i=1, count=0; i<total; i++) {
    	        var last = points[i-1];
    	        var cur = points[i];
    	        var next = i<points.length-1 ? points[i+1] : null;
    	        var thickness = this.mapThickness(cur, i, points);
    	        var amt = this._seg(complex, count, last, cur, next, thickness/2);
    	        count += amt;
    	    }
    	    return complex
    	};

    	Stroke.prototype._seg = function(complex, index, last, cur, next, halfThick) {
    	    var count = 0;
    	    var cells = complex.cells;
    	    var positions = complex.positions;
    	    var capSquare = this.cap === 'square';
    	    var joinBevel = this.join === 'bevel';

    	    //get unit direction of line
    	    direction(lineA, cur, last);

    	    //if we don't yet have a normal from previous join,
    	    //compute based on line start - end
    	    if (!this._normal) {
    	        this._normal = vec.create();
    	        normal(this._normal, lineA);
    	    }

    	    //if we haven't started yet, add the first two points
    	    if (!this._started) {
    	        this._started = true;

    	        //if the end cap is type square, we can just push the verts out a bit
    	        if (capSquare) {
    	            vec.scaleAndAdd(capEnd, last, lineA, -halfThick);
    	            last = capEnd;
    	        }

    	        extrusions(positions, last, this._normal, halfThick);
    	    }

    	    cells.push([index+0, index+1, index+2]);

    	    /*
    	    // now determine the type of join with next segment

    	    - round (TODO)
    	    - bevel 
    	    - miter
    	    - none (i.e. no next segment, use normal)
    	     */
    	    
    	    if (!next) { //no next segment, simple extrusion
    	        //now reset normal to finish cap
    	        normal(this._normal, lineA);

    	        //push square end cap out a bit
    	        if (capSquare) {
    	            vec.scaleAndAdd(capEnd, cur, lineA, halfThick);
    	            cur = capEnd;
    	        }

    	        extrusions(positions, cur, this._normal, halfThick);
    	        cells.push(this._lastFlip===1 ? [index, index+2, index+3] : [index+2, index+1, index+3]);

    	        count += 2;
    	     } else { //we have a next segment, start with miter
    	        //get unit dir of next line
    	        direction(lineB, next, cur);

    	        //stores tangent & miter
    	        var miterLen = computeMiter(tangent, miter, lineA, lineB, halfThick);

    	        // normal(tmp, lineA)
    	        
    	        //get orientation
    	        var flip = (vec.dot(tangent, this._normal) < 0) ? -1 : 1;

    	        var bevel = joinBevel;
    	        if (!bevel && this.join === 'miter') {
    	            var limit = miterLen / (halfThick);
    	            if (limit > this.miterLimit)
    	                bevel = true;
    	        }

    	        if (bevel) {    
    	            //next two points in our first segment
    	            vec.scaleAndAdd(tmp, cur, this._normal, -halfThick * flip);
    	            positions.push(vec.clone(tmp));
    	            vec.scaleAndAdd(tmp, cur, miter, miterLen * flip);
    	            positions.push(vec.clone(tmp));


    	            cells.push(this._lastFlip!==-flip
    	                    ? [index, index+2, index+3] 
    	                    : [index+2, index+1, index+3]);

    	            //now add the bevel triangle
    	            cells.push([index+2, index+3, index+4]);

    	            normal(tmp, lineB);
    	            vec.copy(this._normal, tmp); //store normal for next round

    	            vec.scaleAndAdd(tmp, cur, tmp, -halfThick*flip);
    	            positions.push(vec.clone(tmp));

    	            // //the miter is now the normal for our next join
    	            count += 3;
    	        } else { //miter
    	            //next two points for our miter join
    	            extrusions(positions, cur, miter, miterLen);
    	            cells.push(this._lastFlip===1
    	                    ? [index, index+2, index+3] 
    	                    : [index+2, index+1, index+3]);

    	            flip = -1;

    	            //the miter is now the normal for our next join
    	            vec.copy(this._normal, miter);
    	            count += 2;
    	        }
    	        this._lastFlip = flip;
    	     }
    	     return count
    	};

    	function extrusions(positions, point, normal, scale) {
    	    //next two points to end our segment
    	    vec.scaleAndAdd(tmp, point, normal, -scale);
    	    positions.push(vec.clone(tmp));

    	    vec.scaleAndAdd(tmp, point, normal, scale);
    	    positions.push(vec.clone(tmp));
    	}

    	extrudePolyline = Stroke;
    	return extrudePolyline;
    }

    var extrudePolylineExports = requireExtrudePolyline();
    var extrude = /*@__PURE__*/getDefaultExportFromCjs(extrudePolylineExports);

    /**
     * A pattern as canvas's setLineDash reads it, prepared once for every contour
     * it is walked along: an odd-length pattern repeats to make it even, and the
     * offset skips into the pattern before the first point. Null when it draws
     * solid.
     *
     * `bridge` is how much of a gap the caps at two facing run ends close between
     * them, which is the stroke width for a square cap and nothing for the others.
     * See bridgeGaps.
     */
    function prepareDash(pattern, offset = 0, bridge = 0) {
        const even = normalizePattern(pattern);
        const closed = even && bridgeGaps(even, bridge);
        if (!closed) {
            return null;
        }
        const dashes = closed.dashes;
        const total = dashes.reduce((a, b) => a + b, 0);
        let index = 0;
        let remaining = dashes[0];
        let on = true;
        // Wind the pattern forward by the offset before drawing anything.
        let skip = (((offset + closed.shift) % total) + total) % total;
        while (skip > 0) {
            const step = Math.min(skip, remaining);
            remaining -= step;
            skip -= step;
            if (remaining <= 0) {
                index = (index + 1) % dashes.length;
                remaining = dashes[index];
                on = !on;
            }
        }
        return { dashes, index, remaining, on };
    }
    /**
     * Splits a polyline into the drawn runs of a dash, one polyline per run, so
     * callers can render them as ordinary line segments.
     */
    function dashPolyline(points, dash) {
        if (points.length < 2) {
            return [];
        }
        const { dashes } = dash;
        let { index, remaining, on } = dash;
        const runs = [];
        let current = on ? [points[0]] : [];
        for (let i = 0; i < points.length - 1; i++) {
            const [x1, y1] = points[i];
            const [x2, y2] = points[i + 1];
            let length = Math.hypot(x2 - x1, y2 - y1);
            if (length === 0) {
                continue;
            }
            const dx = (x2 - x1) / length;
            const dy = (y2 - y1) / length;
            let travelled = 0;
            while (length > remaining) {
                travelled += remaining;
                length -= remaining;
                const cut = [x1 + dx * travelled, y1 + dy * travelled];
                if (on) {
                    current.push(cut);
                    runs.push(current);
                    current = [];
                }
                else {
                    current = [cut];
                }
                on = !on;
                index = (index + 1) % dashes.length;
                remaining = dashes[index];
            }
            remaining -= length;
            if (on) {
                current.push(points[i + 1]);
            }
        }
        if (current.length >= 2) {
            runs.push(current);
        }
        // A closed contour has no start: canvas strokes it as one loop, so a run that
        // reaches the seam and one that leaves it are a single run through a corner.
        // Left apart they meet as two flat ends and the corner goes unpainted.
        const last = points.length - 1;
        if (runs.length > 1 &&
            samePoint(points[0], points[last]) &&
            samePoint(runs[0][0], points[0]) &&
            samePoint(runs[runs.length - 1][runs[runs.length - 1].length - 1], points[last])) {
            const tail = runs.pop();
            runs[0] = [...tail, ...runs[0].slice(1)];
        }
        return runs;
    }
    /**
     * The pattern with every gap the caps close over folded into the runs either
     * side, and how far that moved the pattern's start.
     *
     * A square cap reaches half the stroke width past the end of its run, so two
     * runs with less than a stroke width between them meet, and the two caps fill
     * the gap exactly. Merging them is the same shape and drops the overlap, which
     * we would otherwise composite twice. Only square: two round caps cross short
     * of the stroke edge and leave a notch either side that a merged run paints
     * over, which is a bigger error than the overlap.
     *
     * Null when no gap survives, so the whole stroke is solid.
     */
    function bridgeGaps(values, bridge) {
        if (bridge <= 0) {
            return { dashes: values, shift: 0 };
        }
        const dashes = [];
        let on = 0;
        for (let i = 0; i < values.length; i += 2) {
            on += values[i];
            const gap = values[i + 1];
            if (gap <= bridge) {
                on += gap;
                continue;
            }
            dashes.push(on, gap);
            on = 0;
        }
        if (dashes.length === 0) {
            return null;
        }
        if (on > 0) {
            // The tail joins the first run of the next turn of the pattern, so the
            // merged one starts that much earlier and the offset winds it back.
            dashes[0] += on;
            return { dashes, shift: on };
        }
        return { dashes, shift: 0 };
    }
    function samePoint(a, b) {
        return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
    }
    /** Even-length, all-finite, non-zero-total pattern, or null to draw solid. */
    function normalizePattern(pattern) {
        if (!pattern?.length) {
            return null;
        }
        const values = pattern.map(v => (Number.isFinite(v) && v > 0 ? v : 0));
        if (values.reduce((a, b) => a + b, 0) <= 0) {
            return null;
        }
        return values.length % 2 === 0 ? values : [...values, ...values];
    }

    /** Flat at the end point, which is canvas's default cap. */
    const KIND_BUTT = 0;
    /** A half disc of the stroke's own width, for `strokeCap: 'round'`. */
    const KIND_ROUND_CAP = 1;
    /** Cut against the bisector and rounded off at the end point. */
    const KIND_ROUND_JOIN = 2;
    /** Cut against the bisector, with the axis running on to the corner's own apex. */
    const KIND_MITER = 3;
    /** The same, clipped at `cut` along the bisector where the limit bites. */
    const KIND_BEVEL = 4;
    /** Rounded off and cut back toward the end it faces, `cut` being half the way. */
    const KIND_CAP_MEET = 5;
    const BUTT_END = [0, 0, 0, KIND_BUTT];
    const ROUND_END = [0, 0, 0, KIND_ROUND_CAP];
    /** What canvas uses when the item sets neither. */
    const DEFAULT_MITER_LIMIT = 10;
    /** The join and limit of an item, defaulted the way vega's canvas renderer does. */
    function joinStyleOf(item) {
        return { style: item.strokeJoin || 'miter', miterLimit: item.strokeMiterLimit || DEFAULT_MITER_LIMIT };
    }
    /**
     * The join at `at`, between the segment arriving from `prev` and the one
     * leaving towards `next`, written as four floats at `out[i]`.
     *
     * Writing in place rather than returning: a stroked choropleth joins hundreds
     * of thousands of vertices a frame, and a tuple each would be that many
     * allocations.
     *
     */
    function writeJoin(out, i, prev, at, next, halfWidth, style, miterLimit) {
        const d1x = at[0] - prev[0];
        const d1y = at[1] - prev[1];
        const d2x = next[0] - at[0];
        const d2y = next[1] - at[1];
        const l1 = Math.hypot(d1x, d1y);
        const l2 = Math.hypot(d2x, d2y);
        if (l1 < 1e-9 || l2 < 1e-9) {
            writeEnd(out, i, BUTT_END);
            return;
        }
        const ax = d1x / l1;
        const ay = d1y / l1;
        const bx = d2x / l2;
        const by = d2y / l2;
        // the exterior bisector, which points at the outside of the turn
        let mx = ax - bx;
        let my = ay - by;
        const ml = Math.hypot(mx, my);
        if (ml < 1e-9) {
            // collinear, so the flat cut is already exact and there is no corner
            writeEnd(out, i, BUTT_END);
            return;
        }
        mx /= ml;
        my /= ml;
        out[i] = mx;
        out[i + 1] = my;
        if (style === 'round') {
            out[i + 2] = 0;
            out[i + 3] = KIND_ROUND_JOIN;
            return;
        }
        // cosine of the half angle, as the bisector against the arriving normal
        const cos = Math.abs(mx * -ay + my * ax);
        const miter = cos > 1e-6 ? 1 / cos : Infinity;
        const bevelled = style === 'bevel' || miter > miterLimit;
        out[i + 2] = bevelled ? Math.max(halfWidth * cos, 1e-4) : halfWidth * miter;
        out[i + 3] = bevelled ? KIND_BEVEL : KIND_MITER;
    }
    /** Writes a fixed end, for a cap or a vertex with no join. */
    function writeEnd(out, i, end) {
        out[i] = end[0];
        out[i + 1] = end[1];
        out[i + 2] = end[2];
        out[i + 3] = end[3];
    }
    /** The cap style of an item, as the end both outer ends of its runs take. */
    function capEnd(strokeCap) {
        return strokeCap === 'round' ? ROUND_END : BUTT_END;
    }
    /** True when a run returns to where it started, so its seam is a join. */
    function isLoop(run) {
        return run.length > 2 && samePoint(run[0], run[run.length - 1]);
    }

    /** extrude-polyline knows miter and bevel, so a round join takes the miter. */
    function extrudeJoin(strokeJoin) {
        return strokeJoin === 'bevel' ? 'bevel' : 'miter';
    }
    /**
     * Reopens a closed ring at the midpoint of its first segment.
     * extrude-polyline builds no join at the seam when it is told a polyline is
     * closed, which drops the outer miter at the contour's first vertex: a stroked
     * square came out with three corners. Starting on a straight run puts every
     * real vertex in the interior, and the two butt caps meet exactly on it.
     */
    function reopenRing(points) {
        const ring = points.slice();
        const last = ring[ring.length - 1];
        if (!samePoint(ring[0], last)) {
            return null; // an open contour, stroke it as it is
        }
        ring.pop();
        if (ring.length < 3) {
            return null;
        }
        const mid = [(ring[0][0] + ring[1][0]) / 2, (ring[0][1] + ring[1][1]) / 2];
        return [mid, ...ring.slice(1), ring[0], mid];
    }
    const IDENTITY = { angle: 0, scaleX: 1, scaleY: 1 };
    const DEG_TO_RAD = Math.PI / 180;
    /** An item's `angle` in radians, which vega gives in degrees. */
    function itemTurn(item) {
        return (item.angle || 0) * DEG_TO_RAD;
    }
    /**
     * Converts triangulated path geometry into per-item fill and stroke
     * triangle buffers. `dx`/`dy` apply an item-local translation (e.g. the
     * x/y of a path mark item). Group translation is handled by the render
     * offset uniform and must NOT be baked in here.
     */
    function geometryForItem(context, item, shapeGeom, cache = false, dx = 0, dy = 0, transform = IDENTITY) {
        const { angle, scaleX, scaleY } = transform;
        const lineWidth = item.strokeWidth ?? 1;
        const lineCap = item.strokeCap ?? 'butt';
        const lineJoin = extrudeJoin(item.strokeJoin);
        const miterLimit = joinStyleOf(item).miterLimit;
        const opacity = item.opacity ?? 1;
        let fillOpacity = opacity * (item.fillOpacity ?? 1);
        let strokeOpacity = opacity * (item.strokeOpacity ?? 1);
        const fillTriangleCoords = shapeGeom.triangles;
        if (item.fill === 'transparent') {
            fillOpacity = 0;
        }
        const fill = Boolean(item.fill) && fillOpacity > 0;
        if (item.stroke === 'transparent') {
            strokeOpacity = 0;
        }
        const strokeOn = lineWidth > 0 && Boolean(item.stroke) && strokeOpacity > 0;
        // The path alone does not determine the geometry: stroke width, cap and the
        // item translation all move vertices, and whether a fill or stroke is built
        // at all changes what comes back.
        const source = cache ? shapeGeom.key : undefined;
        const variant = source &&
            `${source.variant}|${lineWidth}|${lineCap}|${lineJoin}|${miterLimit}|${dx}|${dy}|${angle}|${scaleX}|${scaleY}|${fill ? 1 : 0}|${strokeOn ? 1 : 0}`;
        if (source && variant) {
            const entry = context._geometryCache.get(source.path)?.get(variant);
            if (entry) {
                return entry;
            }
        }
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const rotateInto = (x, y, out, i) => {
            out[i] = x * cos - y * sin + dx;
            out[i + 1] = x * sin + y * cos + dy;
        };
        const fillVertexCount = fill ? fillTriangleCoords.length / 2 : 0;
        const strokeMeshes = [];
        let strokeCellCount = 0;
        if (strokeOn) {
            const strokeExtrude = extrude({
                thickness: lineWidth,
                cap: lineCap,
                join: lineJoin,
                // at 1 almost every corner is bevel-cut
                miterLimit,
                closed: false,
            });
            const pad = miterLimit * lineWidth;
            const scaled = scaleX === 1 && scaleY === 1
                ? shapeGeom.lines
                : shapeGeom.lines.map(l => l.map(p => [p[0] * scaleX, p[1] * scaleY]));
            for (const line of scaled) {
                const mesh = strokeExtrude.build(reopenRing(line) ?? line);
                let minX = Infinity;
                let minY = Infinity;
                let maxX = -Infinity;
                let maxY = -Infinity;
                for (const p of line) {
                    if (p[0] < minX)
                        minX = p[0];
                    if (p[0] > maxX)
                        maxX = p[0];
                    if (p[1] < minY)
                        minY = p[1];
                    if (p[1] > maxY)
                        maxY = p[1];
                }
                strokeMeshes.push({ mesh, lo: [minX - pad, minY - pad], hi: [maxX + pad, maxY + pad] });
                strokeCellCount += mesh.cells.length;
            }
        }
        const triangles = new Float32Array(fillVertexCount * 2);
        const strokeTriangles = new Float32Array(strokeCellCount * 3 * 2);
        if (fill) {
            for (let i = 0; i < fillTriangleCoords.length; i += 2) {
                rotateInto(fillTriangleCoords[i] * scaleX, fillTriangleCoords[i + 1] * scaleY, triangles, i);
            }
        }
        let strokeVertexCount = 0;
        if (strokeMeshes.length > 0) {
            let i = 0;
            for (const { mesh, lo, hi } of strokeMeshes) {
                const { positions, cells } = mesh;
                // A contour that doubles back on itself (A to B to A, which geographic
                // slivers produce) turns by almost 180 degrees, and the miter there comes
                // back either NaN or thousands of pixels away. Either one smears its
                // triangle across the whole canvas, so drop the cell.
                const usable = (pi) => {
                    const p = positions[pi];
                    return (Number.isFinite(p[0]) &&
                        Number.isFinite(p[1]) &&
                        p[0] >= lo[0] &&
                        p[0] <= hi[0] &&
                        p[1] >= lo[1] &&
                        p[1] <= hi[1]);
                };
                for (const cell of cells) {
                    if (!cell.every(usable)) {
                        continue;
                    }
                    for (const pointIndex of cell) {
                        const p = positions[pointIndex];
                        // the contours were scaled before extrusion, so this only rotates
                        rotateInto(p[0], p[1], strokeTriangles, i * 2);
                        i++;
                    }
                }
            }
            strokeVertexCount = i;
        }
        const result = {
            fillTriangles: triangles,
            strokeTriangles,
            fillCount: fillVertexCount,
            strokeCount: strokeVertexCount,
        };
        if (source && variant) {
            setVariant(context._geometryCache, source.path, variant, result);
        }
        return result;
    }

    /**
     * WGSL every shader shares, and the machinery that specializes a shader for a
     * blend mode. Sources are built in TypeScript so a variant is a string the
     * registry composes, rather than one file per combination.
     */
    /**
     * The group 0 uniform block every mark shader binds, laid out the way
     * BufferManager writes it, with `dpi()` for the shaders that measure in device
     * pixels.
     */
    function uniformBlock() {
        return `struct Uniforms { resolution: vec2<f32>, offset: vec2<f32>, clip: vec4<f32>, clipRadii: vec4<f32>, clipMask: vec4<f32>, dpi: f32, } @group(0) @binding(0) var<uniform> uniforms: Uniforms; @group(0) @binding(1) var clipMaskTexture: texture_2d<f32>; fn dpi() -> f32 { return max(uniforms.dpi, 0.001); }`;
    }
    /** Canvas pixels to clip space. y flips because canvas coordinates grow down. */
    const TO_NDC = `fn toNdc(p: vec2<f32>, resolution: vec2<f32>) -> vec2<f32> { var q = p / resolution; q.y = 1.0 - q.y; return q * 2.0 - 1.0; }`;
    /**
     * How each blend mode wants its source colour, given straight alpha.
     *
     * Canvas applies a blend as `dst * (1 - a) + a * f(src, dst)`, so the source
     * has to be weighted by its own alpha somewhere. WebGPU's factors cannot do it
     * and reach the destination at the same time, so the shader does it instead.
     * For multiply and screen that makes the result exact at every alpha: the
     * premultiplied colour paired with their factors expands to canvas's formula.
     *
     * min and max have no term to interpolate with, so darken and lighten stay
     * exact only at alpha 0 and 1. Weighting towards the operation's identity
     * (white for min, black for max) at least leaves an antialiased edge alone,
     * where an unweighted colour applies the full blend to a fragment that barely
     * covers the pixel.
     */
    const SOURCE_COLOR = {
        normal: 'c',
        multiply: 'vec4<f32>(c.rgb * c.a, c.a)',
        screen: 'vec4<f32>(c.rgb * c.a, c.a)',
        darken: 'vec4<f32>(mix(vec3<f32>(1.0), c.rgb, c.a), c.a)',
        lighten: 'vec4<f32>(c.rgb * c.a, c.a)',
    };
    function fragmentEntry(entryPoint, colorFn) {
        return `@fragment fn ${entryPoint}(in: VertexOutput) -> @location(0) vec4<f32> { let clipCov = clipCoverage(in.pos.xy); if clipCov <= 0.0 { discard; } let raw = ${colorFn}(in); let c = vec4<f32>(raw.rgb, raw.a * clipCov); if c.a <= 0.0 { discard; } return blendAdjust(c); }`;
    }
    /**
     * How much of a fragment the clip's rounded corners leave.
     *
     * A clip is a scissor rect, which is exact for a plain box and cannot express
     * the rounded rectangle canvas clips a group to when it has a cornerRadius.
     * The scissor still does the rejecting, so this only has to cut the four
     * corners, and it is skipped outright when there is no radius to cut.
     *
     * Coverage rather than a discard, because canvas antialiases the edge of a
     * clip path. Cutting on a test instead leaves the corner stepped, which reads
     * 93 against canvas where the fraction reads 25.
     */
    const INSIDE_CLIP = `fn clipCoverage(p: vec2<f32>) -> f32 { var cov = 1.0; if uniforms.clipMask.x > 0.5 { cov = textureLoad(clipMaskTexture, vec2<i32>(p), 0).r; if cov <= 0.0 { return 0.0; } } let r = uniforms.clipRadii; if r.x <= 0.0 && r.y <= 0.0 && r.z <= 0.0 && r.w <= 0.0 { return cov; } let lo = uniforms.clip.xy; let hi = lo + uniforms.clip.zw; var c = vec2<f32>(0.0, 0.0); var radius = 0.0; if p.x < lo.x + r.x && p.y < lo.y + r.x { c = lo + vec2<f32>(r.x, r.x); radius = r.x; } else if p.x > hi.x - r.y && p.y < lo.y + r.y { c = vec2<f32>(hi.x - r.y, lo.y + r.y); radius = r.y; } else if p.x > hi.x - r.z && p.y > hi.y - r.z { c = hi - vec2<f32>(r.z, r.z); radius = r.z; } else if p.x < lo.x + r.w && p.y > hi.y - r.w { c = vec2<f32>(lo.x + r.w, hi.y - r.w); radius = r.w; } else { return cov; } return cov * clamp(radius + 0.5 - distance(p, c), 0.0, 1.0); }`;
    /**
     * Every shader ends this way: `blendAdjust` for the mode, then one fragment
     * entry point per colour function. A colour function returns straight alpha and
     * the entry point drops a fragment covering nothing before weighting the rest.
     *
     * The discard is not an optimization. Marks grow their geometry past the shape
     * so an analytic edge is not clipped, and those empty fragments still change
     * the destination under a multiply or a min.
     */
    function fragmentTail(blend, entries = DEFAULT_ENTRY) {
        const prelude = `fn blendAdjust(c: vec4<f32>) -> vec4<f32> { return ${SOURCE_COLOR[blend] ?? SOURCE_COLOR.normal}; }`;
        return [INSIDE_CLIP, prelude, ...Object.entries(entries).map(([name, fn]) => fragmentEntry(name, fn))].join('\n\n');
    }
    const DEFAULT_ENTRY = { main_fragment: 'fragmentColor' };
    /** A segment direction that survives a zero-length segment, and its normal. */
    const SEGMENT_NORMAL = `fn safeDirection(d: vec2<f32>) -> vec2<f32> { return select(vec2<f32>(1.0, 0.0), normalize(d), length(d) > 1e-9); } fn normalAt(d: vec2<f32>) -> vec2<f32> { let dir = safeDirection(d); return vec2<f32>(-dir.y, dir.x); }`;
    /**
     * The stroke over the fill, each taking its true share of the pixel.
     * Thresholding instead would hand the whole pixel to one of them, which drops
     * the inner half of any stroke thin enough to straddle a pixel boundary.
     *
     * Over, not side by side. Canvas fills the whole shape and then strokes on top,
     * so a stroke that is translucent shows the fill through it and one that is
     * fully transparent leaves the fill untouched. Giving the stroke band to the
     * stroke alone instead ate a ring off every such shape: a vega legend swatch is
     * `stroke: transparent` with a width of 1.5, which came out 8px across where
     * canvas draws 10. An opaque stroke covers the fill under it either way, so
     * nothing that was already right moves.
     */
    const FILL_STROKE_SHARE = `fn fillStrokeShare(fill: vec4<f32>, stroke: vec4<f32>, fillCov: f32, strokeCov: f32) -> vec4<f32> { let sa = stroke.a * strokeCov; let fa = fill.a * fillCov * (1.0 - sa); let a = sa + fa; return vec4<f32>((stroke.rgb * sa + fill.rgb * fa) / max(a, 1e-6), a); }`;
    /**
     * Fraction of the pixel covered by an axis-aligned box, computed the way canvas
     * does it rather than from MSAA samples. Two abutting rects then produce
     * complementary coverage, so the seam is the faint one canvas leaves and not a
     * whole missing sample. A deliberate gap between them is preserved exactly,
     * because the geometry is untouched. lo/hi are in device pixels.
     *
     * Taking the difference of the two edges rather than the distance to the
     * nearer one is what keeps a box thinner than a pixel honest: the near edge
     * alone reports a 0.2 px border as 0.6 covered.
     */
    const BOX_COVERAGE = `fn boxCoverage(p: vec2<f32>, lo: vec2<f32>, hi: vec2<f32>) -> f32 { let cx = clamp(hi.x - p.x + 0.5, 0.0, 1.0) - clamp(lo.x - p.x + 0.5, 0.0, 1.0); let cy = clamp(hi.y - p.y + 0.5, 0.0, 1.0) - clamp(lo.y - p.y + 0.5, 0.0, 1.0); return cx * cy; }`;
    /** The two triangles of a unit square, for a vertex stage that indexes its corners. */
    const UNIT_QUAD = `array( vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 1.0), )`;
    /**
     * Straight colour out of a premultiplied texel. Textures stay premultiplied so
     * filtering does not darken an edge, and the blend state takes straight alpha.
     */
    const UNPREMULTIPLY = `fn unpremultiply(c: vec4<f32>) -> vec3<f32> { return c.rgb / max(c.a, 1e-6); }`;

    const MODES = {
        normal: {},
        multiply: { blend: 'cb * cs' },
        screen: { blend: 'cb + cs - cb * cs' },
        darken: { blend: 'min(cb, cs)' },
        lighten: { blend: 'max(cb, cs)' },
        overlay: { blend: 'blendHardLight(cs, cb)' },
        'hard-light': { blend: 'blendHardLight(cb, cs)' },
        'soft-light': { blend: 'blendSoftLight(cb, cs)' },
        'color-dodge': { blend: 'blendColorDodge(cb, cs)' },
        'color-burn': { blend: 'blendColorBurn(cb, cs)' },
        difference: { blend: 'abs(cb - cs)' },
        exclusion: { blend: 'cb + cs - 2.0 * cb * cs' },
        hue: { blend: 'setLum(setSat(cs, sat(cb)), lum(cb))' },
        saturation: { blend: 'setLum(setSat(cb, sat(cs)), lum(cb))' },
        color: { blend: 'setLum(cs, lum(cb))' },
        luminosity: { blend: 'setLum(cb, lum(cs))' },
        // the Porter Duff operators, which canvas takes in the same property
        'destination-over': { fa: '1.0 - ba', fb: '1.0' },
        'source-in': { fa: 'ba', fb: '0.0', erases: true },
        'destination-in': { fa: '0.0', fb: 'sa', erases: true },
        'source-out': { fa: '1.0 - ba', fb: '0.0', erases: true },
        'destination-out': { fa: '0.0', fb: '1.0 - sa' },
        'source-atop': { fa: 'ba', fb: '1.0 - sa' },
        'destination-atop': { fa: '1.0 - ba', fb: 'sa', erases: true },
        xor: { fa: '1.0 - ba', fb: '1.0 - sa' },
        lighter: { fa: '1.0', fb: '1.0' },
        copy: { fa: '1.0', fb: '0.0', erases: true },
    };
    /** Every mode this can evaluate, which is every one canvas has. */
    const BLEND_MODES = Object.keys(MODES);
    const BLEND_HELPERS = `fn blendHardLight(cb: vec3<f32>, cs: vec3<f32>) -> vec3<f32> { return select(1.0 - 2.0 * (1.0 - cb) * (1.0 - cs), 2.0 * cb * cs, cs <= vec3<f32>(0.5)); } fn blendSoftLight(cb: vec3<f32>, cs: vec3<f32>) -> vec3<f32> { let d = select(sqrt(cb), ((16.0 * cb - 12.0) * cb + 4.0) * cb, cb <= vec3<f32>(0.25)); let lo = cb - (1.0 - 2.0 * cs) * cb * (1.0 - cb); let hi = cb + (2.0 * cs - 1.0) * (d - cb); return select(hi, lo, cs <= vec3<f32>(0.5)); } fn blendColorDodge(cb: vec3<f32>, cs: vec3<f32>) -> vec3<f32> { let lit = select(min(vec3<f32>(1.0), cb / max(1.0 - cs, vec3<f32>(1e-6))), vec3<f32>(1.0), cs >= vec3<f32>(1.0)); return select(lit, vec3<f32>(0.0), cb <= vec3<f32>(0.0)); } fn blendColorBurn(cb: vec3<f32>, cs: vec3<f32>) -> vec3<f32> { let burnt = select( 1.0 - min(vec3<f32>(1.0), (1.0 - cb) / max(cs, vec3<f32>(1e-6))), vec3<f32>(0.0), cs <= vec3<f32>(0.0), ); return select(burnt, vec3<f32>(1.0), cb >= vec3<f32>(1.0)); } fn lum(c: vec3<f32>) -> f32 { return dot(c, vec3<f32>(0.3, 0.59, 0.11)); } fn clipColor(c: vec3<f32>) -> vec3<f32> { let l = lum(c); let lo = min(c.r, min(c.g, c.b)); let hi = max(c.r, max(c.g, c.b)); var out = c; if lo < 0.0 { out = l + (out - l) * l / max(l - lo, 1e-6); } if hi > 1.0 { out = l + (out - l) * (1.0 - l) / max(hi - l, 1e-6); } return out; } fn setLum(c: vec3<f32>, l: f32) -> vec3<f32> { return clipColor(c + (l - lum(c))); } fn sat(c: vec3<f32>) -> f32 { return max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b)); } fn setSat(c: vec3<f32>, s: f32) -> vec3<f32> { let lo = min(c.r, min(c.g, c.b)); let range = max(c.r, max(c.g, c.b)) - lo; return select(vec3<f32>(0.0), (c - lo) * s / range, vec3<bool>(range > 0.0)); }`;
    /**
     * The source over the destination with a blend applied, computed rather than
     * left to fixed function factors.
     *
     * Canvas composites a blended mark as `as*(1-ab)*Cs + as*ab*B(Cb,Cs) + * (1-as)*ab*Cb`. One set of factors reaches the destination or weights the
     * source by its own alpha, not both, so multiply and screen come out exact only
     * because their algebra happens to fold, and min and max have no term to
     * interpolate with at all: darken and lighten are wrong wherever the source is
     * not fully opaque, which includes every antialiased edge.
     *
     * The mark is drawn into a layer of its own instead, the frame is copied out
     * beneath it, and this evaluates the formula on the two and replaces the pixel.
     */
    const blendCompositeShader = (blend) => {
        const mode = MODES[blend] ?? MODES.normal;
        return ` ${BLEND_HELPERS} ${UNPREMULTIPLY} @group(0) @binding(0) var layerTexture: texture_2d<f32>; @group(0) @binding(1) var backdropTexture: texture_2d<f32>; struct VertexOutput { @builtin(position) pos: vec4<f32>, } @vertex fn main_vertex(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput { var corners = array(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0)); var out: VertexOutput; out.pos = vec4<f32>(corners[vertexIndex], 0.0, 1.0); return out; } @fragment fn main_fragment(in: VertexOutput) -> @location(0) vec4<f32> { let at = vec2<i32>(in.pos.xy); let src = textureLoad(layerTexture, at, 0); let dst = textureLoad(backdropTexture, at, 0); let sa = src.a; ${mode.erases
        ? ''
        : ` if sa <= 0.0 { discard; }`} let ba = dst.a; let cs = unpremultiply(src); let cb = unpremultiply(dst); let csp = (1.0 - ba) * cs + ba * (${mode.blend ?? 'cs'}); let fa = ${mode.fa ?? '1.0'}; let fb = ${mode.fb ?? '1.0 - sa'}; return vec4<f32>(sa * fa * csp + fb * dst.rgb, sa * fa + ba * fb); } `;
    };

    /**
     * Vega's `blend` maps onto canvas `globalCompositeOperation`. Four of them fall
     * out of WebGPU's blend factors and operations, and those are the fast path:
     * multiply, screen, darken and lighten, drawn straight into the frame.
     *
     * Every other mode, and those four wherever their algebra does not fold, are
     * evaluated in a shader against a copy of the frame instead. See
     * `needsBackdrop` and shaders/blendComposite.ts.
     */
    const NORMAL = {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    };
    const ALPHA = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' };
    const SUPPORTED = {
        // src * dst
        multiply: { color: { srcFactor: 'dst', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: ALPHA },
        // src + dst * (1 - src)
        screen: { color: { srcFactor: 'one', dstFactor: 'one-minus-src', operation: 'add' }, alpha: ALPHA },
        darken: { color: { srcFactor: 'one', dstFactor: 'one', operation: 'min' }, alpha: ALPHA },
        lighten: { color: { srcFactor: 'one', dstFactor: 'one', operation: 'max' }, alpha: ALPHA },
    };
    /**
     * Modes whose factors cannot also weight the source by its own alpha.
     *
     * multiply and screen fold exactly at any alpha, since their factors expand to
     * the formula canvas uses. min and max have no term to interpolate with, so
     * darken and lighten are right only where the source covers the pixel outright,
     * which leaves out every antialiased edge as well as every translucent mark.
     * Those are drawn into a layer and composited against a copy of the frame.
     */
    const NEEDS_BACKDROP = new Set(['darken', 'lighten']);
    /** Everything the composite can evaluate, which is everything canvas has. */
    const EVALUATED = new Set(BLEND_MODES);
    /**
     * True when the mode has to be evaluated in a shader against a copy of the
     * frame rather than left to the blend state.
     *
     * multiply and screen fold only against an opaque backdrop. The full formula
     * also carries the source over the part of the pixel the backdrop does not
     * cover, and factors that reach the destination cannot carry that as well: a
     * multiply over nothing came out black where canvas draws the source plainly.
     * A frame cleared opaque stays opaque wherever anything draws, since source
     * over leaves the alpha at one, so there the shortcut is exact.
     *
     * A mark that batches its items has to stop batching where this is true. The
     * copy is read once per draw, so two items sharing one would both blend with
     * what was there before either of them, and canvas composites item by item.
     */
    function needsBackdrop(key, opaqueBackdrop) {
        if (key === 'normal') {
            return false;
        }
        return !opaqueBackdrop || NEEDS_BACKDROP.has(key) || !Object.hasOwn(SUPPORTED, key);
    }
    /** Replaces the pixel, for a composite that has already done the blending. */
    const REPLACE = {
        color: { srcFactor: 'one', dstFactor: 'zero', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'zero', operation: 'add' },
    };
    /**
     * The mode a pipeline was asked for, where that mode is evaluated in a shader.
     * Such a pipeline is built to draw unblended, so what it is for is recorded
     * here rather than readable from it, and the queue routes its draws into a
     * layer and folds them back with `blendCompositeElement`.
     */
    const layerModes = new WeakMap();
    /**
     * The mode to build a pipeline with, given the one it was asked for. A mode the
     * blend state cannot express builds unblended, and `record` then ties the
     * pipeline back to what it stands in for so the queue can lift its draws into a
     * layer. Every pipeline that carries a blend goes through this.
     */
    function buildBlend(blend, opaqueBackdrop) {
        if (!needsBackdrop(blend, opaqueBackdrop)) {
            return { blend, record: () => { } };
        }
        return { blend: 'normal', record: pipeline => layerModes.set(pipeline, blend) };
    }
    /** The mode a pipeline's draws are composited with, or undefined for the frame. */
    function layerMode(pipeline) {
        return layerModes.get(pipeline);
    }
    /** Normalizes a mark's blend to one this renderer keys a pipeline by. */
    function blendKey(blend) {
        // vega writes the default either way round, so neither is a mode we lack
        if (!blend || blend === 'normal' || blend === 'source-over') {
            return 'normal';
        }
        if (EVALUATED.has(blend)) {
            return blend;
        }
        warnOnce(`blend:${blend}`, `[vega-webgpu] Blend mode '${blend}' is not one canvas has; drawing it normally.`);
        return 'normal';
    }
    function blendState(key) {
        return SUPPORTED[key] ?? NORMAL;
    }

    /**
     * Items drawn together in one call, in paint order. A change of blend or of
     * `key` closes the run, since a blend belongs to the pipeline and a key to
     * whatever else the draw shares. So does an item whose blend needs the
     * backdrop, which meets the frame on its own the way canvas composites it.
     */
    class DrawRun {
        opaqueBackdrop;
        draw;
        items = [];
        blend = 'normal';
        key;
        constructor(opaqueBackdrop, draw) {
            this.opaqueBackdrop = opaqueBackdrop;
            this.draw = draw;
        }
        add(item, blend, key) {
            if (this.items.length > 0 && (blend !== this.blend || key !== this.key)) {
                this.flush();
            }
            this.blend = blend;
            this.key = key;
            this.items.push(item);
            if (needsBackdrop(blend, this.opaqueBackdrop)) {
                this.flush();
            }
        }
        flush() {
            if (this.items.length > 0) {
                const items = this.items;
                this.items = [];
                this.draw(items, this.blend);
            }
        }
    }

    /**
     * Values gathered from consecutive draws that share one pipeline, so they go
     * up as a single buffer and draw call. Appended in paint order, and held rather
     * than copied as they arrive, since spreading them into one array throws past
     * about 125 thousand values, which a line of seven thousand points reaches.
     */
    class GeometryBatch {
        chunks = [];
        total = 0;
        push(data) {
            if (data.length > 0) {
                this.chunks.push(data);
                this.total += data.length;
            }
        }
        /** Every value pushed, in one array, or null when there were none. Resets the batch. */
        flush() {
            const { chunks, total } = this;
            this.chunks = [];
            this.total = 0;
            return joinChunks(chunks, total);
        }
    }
    /**
     * The chunks in one array, or null when they hold nothing. It is uploaded
     * straight away, so a lone chunk goes up as it is.
     */
    function joinChunks(chunks, total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)) {
        if (total === 0) {
            return null;
        }
        const filled = chunks.filter(chunk => chunk.length > 0);
        if (filled.length === 1 && filled[0] instanceof Float32Array) {
            return filled[0];
        }
        const out = new Float32Array(total);
        let offset = 0;
        for (const chunk of filled) {
            out.set(chunk, offset);
            offset += chunk.length;
        }
        return out;
    }

    // A scene has few distinct group offsets, so this collapses to a handful.
    const MAX_UNIFORM_CACHE = 128;
    /**
     * The shared uniform block as the shaders read it: resolution, group offset,
     * the rounded clip's box and radii, the clip mask flag and the device pixel
     * ratio, padded to a whole number of vec4s.
     */
    const UNIFORM_FLOATS = 20;
    const OFFSET = 2;
    const CLIP_BOX = 4;
    const CLIP_RADII = 8;
    const CLIP_MASK = 12;
    const DPI = 16;
    /**
     * Buffers a frame's draws create, and resources they replace, released once
     * the frame is submitted.
     *
     * A mark mints a buffer per draw and WebGPU frees none of them on its own, so
     * a hovered chart was creating hundreds a frame and holding every one, which
     * reached tens of gigabytes. Destroying is safe after submit: an implementation
     * keeps a buffer alive until the commands referencing it have run.
     */
    class FrameBuffers {
        current = [];
        previous = [];
        hold(resource) {
            this.current.push(resource);
            return resource;
        }
        /**
         * Frees the frame before last. A capture and an image that finishes loading
         * both submit again around a frame, so a buffer is only let go once a later
         * frame has been through as well.
         */
        release() {
            for (const resource of this.previous) {
                resource.destroy();
            }
            this.previous = this.current;
            this.current = [];
        }
    }
    const pools = new WeakMap();
    /** The frame's buffers for a device, which die with it. */
    function bufferPool(device) {
        let pool = pools.get(device);
        if (!pool) {
            pool = new FrameBuffers();
            pools.set(device, pool);
        }
        return pool;
    }
    /**
     * Uploads through the queue rather than mappedAtCreation. A mapped range
     * costs one JS ArrayBuffer per buffer and a frame creates a buffer per mark,
     * which exhausts that allocation on a memory-constrained runner: every
     * create then throws "size (32) is too large for the implementation".
     *
     * `lasting` keeps the buffer out of the frame pool, for the few that are held
     * across frames rather than rebuilt.
     */
    function uploadBuffer(device, label, data, usage, lasting = false) {
        const size = (data.byteLength + 3) & -4;
        const buffer = device.createBuffer({ label, size, usage });
        if (!lasting) {
            bufferPool(device).hold(buffer);
        }
        const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        // writeBuffer copies whole words, so an unaligned tail needs padding
        let src = bytes;
        if (size !== data.byteLength) {
            src = new Uint8Array(size);
            src.set(bytes);
        }
        device.queue.writeBuffer(buffer, 0, src, 0, size);
        return buffer;
    }
    /**
     * A mark's buffers and the uniform block they share. getMarkResources sets the
     * resolution, offset and clip before every draw, since the manager outlives the
     * frame that made it.
     */
    class BufferManager {
        device;
        bufferName;
        // a draw queued this frame may still read an evicted one, so the pool frees it later
        uniformCache = new LruMap(MAX_UNIFORM_CACHE, buffer => bufferPool(this.device).hold(buffer));
        uniforms = new Float32Array(UNIFORM_FLOATS);
        /** The uniforms as the shared buffer cache keys them, until a setter changes one. */
        uniformKey = null;
        constructor(device, bufferName) {
            this.device = device;
            this.bufferName = bufferName;
            this.uniforms[DPI] = 1;
        }
        createUniformBuffer() {
            return uploadBuffer(this.device, `${this.bufferName} Uniform Buffer`, this.uniforms, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
        }
        /**
         * Uniform buffer for the current resolution and offset, reused across draws
         * that share them. Marks that draw many times per frame would otherwise mint
         * one per draw. Keyed by the values rather than shared outright, because the
         * render queue defers every draw to the end of the frame: one buffer rewritten
         * per group would hand every draw the last group's offset.
         */
        sharedUniformBuffer() {
            const key = (this.uniformKey ??= this.uniforms.join(','));
            let buffer = this.uniformCache.get(key);
            if (!buffer) {
                // cached across frames by value, so it cannot come from the frame pool
                buffer = uploadBuffer(this.device, `${this.bufferName} Uniform`, this.uniforms, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, true);
                this.uniformCache.set(key, buffer);
            }
            return buffer;
        }
        createGeometryBuffer(data, lasting = false) {
            return uploadBuffer(this.device, `${this.bufferName} Geometry Buffer`, data, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, lasting);
        }
        createInstanceBuffer(data) {
            return uploadBuffer(this.device, `${this.bufferName} Instance Buffer`, data, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);
        }
        setResolution([width, height]) {
            this.setUniform(0, width);
            this.setUniform(1, height);
        }
        setOffset(x, y) {
            this.setUniform(OFFSET, x);
            this.setUniform(OFFSET + 1, y);
        }
        setDpi(dpi) {
            this.setUniform(DPI, dpi || 1);
        }
        /**
         * The rounded clip every draw from this mark is held to. A scissor rect is
         * exact for a plain box and already carries every clip in the chain, so the
         * shader is only told about the box whose corners it has to cut.
         */
        setClipRound(round) {
            for (let i = 0; i < 4; i++) {
                this.setUniform(CLIP_BOX + i, round?.box[i] ?? 0);
                this.setUniform(CLIP_RADII + i, round?.radii[i] ?? 0);
            }
        }
        /**
         * Whether a clip path's coverage mask is bound and should be read. The mask
         * itself is a texture binding, and this is what tells the shader to look at
         * it rather than at the placeholder bound when there is no path clip.
         */
        setClipMask(on) {
            this.setUniform(CLIP_MASK, on ? 1 : 0);
        }
        setUniform(index, value) {
            const stored = Math.fround(value);
            if (this.uniforms[index] !== stored) {
                this.uniforms[index] = stored;
                this.uniformKey = null;
            }
        }
    }

    /**
     * Every name in the WebGPU vertex format list is its component type followed
     * by a bit width and an optional `xN`, so the width and the count come out of
     * the name rather than a table that has to be kept in step with it. The packed
     * formats break that rule, and nothing here uses them.
     */
    function parts(format) {
        const match = /(8|16|32)(?:x([234]))?$/.exec(format);
        if (!match) {
            return [0, 0];
        }
        const count = Number(match[2] ?? 1);
        return [(Number(match[1]) / 8) * count, count];
    }
    /** Bytes one attribute of this format takes in a vertex buffer. */
    function formatSize(format) {
        return parts(format)[0];
    }
    /** How many components one attribute of this format supplies to the shader. */
    function formatElementCount(format) {
        return parts(format)[1];
    }

    function layoutOf(formats, stepMode, locationOffset) {
        const attributes = [];
        let totalOffset = 0;
        formats.forEach((format, index) => {
            const size = formatSize(format);
            if (size > 0) {
                attributes.push({ shaderLocation: index + locationOffset, offset: totalOffset, format });
                totalOffset += size;
            }
            else {
                console.error(`[vega-webgpu] Unsupported vertex format: ${format}`);
            }
        });
        return { arrayStride: totalOffset, stepMode, attributes };
    }
    function lengthOf(formats) {
        return formats.reduce((total, format) => total + formatElementCount(format), 0);
    }
    /**
     * Derives GPUVertexBufferLayouts (one per-vertex, one per-instance) from lists
     * of vertex formats, assigning consecutive shader locations.
     *
     * The formats are fixed at construction, so everything derived from them is
     * built once. `layoutKey` is what a pipeline cache keys on, and building it
     * here rather than at every lookup keeps a per-draw JSON.stringify of the whole
     * layout off the hot path.
     */
    class VertexBufferManager {
        buffers;
        vertexLength;
        instanceLength;
        layoutKey;
        constructor(vertexFormats = [], instanceFormats = []) {
            this.vertexLength = lengthOf(vertexFormats);
            this.instanceLength = lengthOf(instanceFormats);
            this.buffers = [];
            if (this.vertexLength > 0) {
                this.buffers.push(layoutOf(vertexFormats, 'vertex', 0));
            }
            if (this.instanceLength > 0) {
                this.buffers.push(layoutOf(instanceFormats, 'instance', vertexFormats.length));
            }
            this.layoutKey = JSON.stringify(this.buffers);
        }
        /** Layouts for pipeline creation; empty layouts are omitted. */
        getBuffers() {
            return this.buffers;
        }
        /** Number of float elements per vertex. */
        getVertexLength() {
            return this.vertexLength;
        }
        /** Number of float elements per instance. */
        getInstanceLength() {
            return this.instanceLength;
        }
    }

    /**
     * Sub-segments each span is split into, and the vertex count a curve draw
     * asks for. Measured against canvas: 8 and 16 are indistinguishable and cost
     * the same, 4 is visibly worse.
     */
    const CURVE_SUBDIVISIONS = 32;
    /**
     * How a span's four control points become a point and a tangent. Every cubic
     * d3 draws is one of these two: basis is the uniform B-spline behind `basis`
     * and `bundle`, bezier is what every other curve emits as a `C` command.
     */
    const CURVES$1 = {
        basis: {
            at: ` let t2 = t * t; let t3 = t2 * t; return ((1.0 - 3.0 * t + 3.0 * t2 - t3) * p0 + (4.0 - 6.0 * t2 + 3.0 * t3) * p1 + (1.0 + 3.0 * t + 3.0 * t2 - 3.0 * t3) * p2 + t3 * p3) / 6.0;`,
            tangent: ` let t2 = t * t; return (-3.0 * (1.0 - t) * (1.0 - t) * p0 + (9.0 * t2 - 12.0 * t) * p1 + (-9.0 * t2 + 6.0 * t + 3.0) * p2 + 3.0 * t2 * p3) / 6.0;`,
        },
        bezier: {
            at: ` let u = 1.0 - t; return u * u * u * p0 + 3.0 * u * u * t * p1 + 3.0 * u * t * t * p2 + t * t * t * p3;`,
            tangent: ` let u = 1.0 - t; return 3.0 * u * u * (p1 - p0) + 6.0 * u * t * (p2 - p1) + 3.0 * t * t * (p3 - p2);`,
        },
    };
    /** Cubic splines evaluated on the GPU, one instance per span. */
    const curveShader = (blend, kind = 'basis') => {
        const curve = CURVES$1[kind];
        if (!curve) {
            throw new Error(`[vega-webgpu] No curve evaluation named '${kind}'.`);
        }
        return ` ${uniformBlock()} ${TO_NDC} struct InstanceInput { @location(0) p0: vec2<f32>, @location(1) p1: vec2<f32>, @location(2) p2: vec2<f32>, @location(3) p3: vec2<f32>, @location(4) color: vec4<f32>, @location(5) stroke_width: f32, @location(6) kind: f32, } struct VertexOutput { @builtin(position) pos: vec4<f32>, @location(0) color: vec4<f32>, @location(1) across: f32, @location(2) half_width: f32, } const K: u32 = ${CURVE_SUBDIVISIONS}u; fn spanQuads(p0: vec2<f32>, p1: vec2<f32>, p2: vec2<f32>, p3: vec2<f32>) -> u32 { let poly = length(p1 - p0) + length(p2 - p1) + length(p3 - p2); let want = u32(ceil(poly * dpi() * 0.5)); return clamp(want, 1u, K); } fn curveAt(p0: vec2<f32>, p1: vec2<f32>, p2: vec2<f32>, p3: vec2<f32>, t: f32) -> vec2<f32> { ${curve.at} } fn curveTangent(p0: vec2<f32>, p1: vec2<f32>, p2: vec2<f32>, p3: vec2<f32>, t: f32) -> vec2<f32> { ${curve.tangent} } fn spanTangent(p0: vec2<f32>, p1: vec2<f32>, p2: vec2<f32>, p3: vec2<f32>, t: f32) -> vec2<f32> { let d = curveTangent(p0, p1, p2, p3, t); return select(p3 - p0, d, length(d) > 1e-6); } ${SEGMENT_NORMAL} fn culled() -> VertexOutput { var out: VertexOutput; out.pos = vec4<f32>(0.0, 0.0, 0.0, 1.0); out.color = vec4<f32>(0.0, 0.0, 0.0, 0.0); out.across = 0.0; out.half_width = 1.0; return out; } @vertex fn main_vertex(instance: InstanceInput, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput { let sub = vertexIndex / 6u; let corner = vertexIndex % 6u; let straight = instance.kind > 0.5; var a: vec2<f32>; var b: vec2<f32>; var na: vec2<f32>; var nb: vec2<f32>; if straight { if sub > 0u { return culled(); } a = instance.p0; b = instance.p1; na = normalAt(b - a); nb = na; } else { let quads = spanQuads(instance.p0, instance.p1, instance.p2, instance.p3); if sub >= quads { return culled(); } let t0 = f32(sub) / f32(quads); let t1 = f32(sub + 1u) / f32(quads); a = curveAt(instance.p0, instance.p1, instance.p2, instance.p3, t0); b = curveAt(instance.p0, instance.p1, instance.p2, instance.p3, t1); na = normalAt(spanTangent(instance.p0, instance.p1, instance.p2, instance.p3, t0)); nb = normalAt(spanTangent(instance.p0, instance.p1, instance.p2, instance.p3, t1)); } let half = instance.stroke_width * 0.5 + 1.0; var point: vec2<f32>; var across: f32; switch corner { case 0u: { point = a - na * half; across = -half; } case 1u: { point = a + na * half; across = half; } case 2u: { point = b - nb * half; across = -half; } case 3u: { point = b - nb * half; across = -half; } case 4u: { point = a + na * half; across = half; } default: { point = b + nb * half; across = half; } } var out: VertexOutput; out.pos = vec4<f32>(toNdc(point - uniforms.offset, uniforms.resolution), 0.0, 1.0); out.color = instance.color; out.across = across; out.half_width = instance.stroke_width * 0.5; return out; } fn fragmentColor(in: VertexOutput) -> vec4<f32> { let d = dpi(); let coverage = clamp((in.half_width - abs(in.across)) * d + 0.5, 0.0, 1.0); return vec4<f32>(in.color.rgb, in.color.a * coverage); } ${fragmentTail(blend)} `;
    };

    /**
     * The gradient ramp bound at group 1, shared by the marks that fill from one.
     * The stops are baked into a 1D texture on the CPU, so a gradient costs a
     * sample rather than a stop loop per fragment.
     */
    const GRADIENT_BLOCK = ` struct GradientParams { coords: vec4<f32>, bounds: vec4<f32>, misc: vec4<f32>, } @group(1) @binding(0) var stopSampler: sampler; @group(1) @binding(1) var stopRamp: texture_2d<f32>; @group(1) @binding(2) var<uniform> gradient: GradientParams; fn gradientT(p: vec2<f32>, wh: vec2<f32>) -> f32 { if gradient.misc.x < 1.5 { let a = gradient.coords.xy; let b = gradient.coords.zw; let ab = b - a; let len2 = max(dot(ab, ab), 1e-6); return clamp(dot(p - a, ab) / len2, 0.0, 1.0); } let m = max(wh.x, wh.y); let c1 = gradient.coords.xy * wh; let c2 = gradient.coords.zw * wh; let r1 = gradient.misc.y * m; let r2 = gradient.misc.z * m; let cd = c2 - c1; let dr = r2 - r1; let pd = p * wh - c1; let a = dot(cd, cd) - dr * dr; let b = dot(pd, cd) + r1 * dr; let c = dot(pd, pd) - r1 * r1; if abs(a) < 1e-6 { if abs(b) < 1e-6 { return 1.0; } return clamp(c / (2.0 * b), 0.0, 1.0); } let disc = b * b - a * c; if disc < 0.0 { return 1.0; } let root = sqrt(disc); let hi = (b + root) / a; let lo = (b - root) / a; if r1 + hi * dr >= 0.0 { return clamp(hi, 0.0, 1.0); } return clamp(lo, 0.0, 1.0); } fn rampAt(world: vec2<f32>) -> vec4<f32> { let p = (world - gradient.bounds.xy) / max(gradient.bounds.zw, vec2<f32>(1e-6, 1e-6)); return textureSample(stopRamp, stopSampler, vec2<f32>(gradientT(p, gradient.bounds.zw), 0.5)); }`;

    /**
     * Triangulated geometry filled from a gradient ramp. The vertex colour carries
     * only the computed fill opacity, the ramp supplies the rest.
     */
    const gradientFillShader = (blend) => ` ${uniformBlock()} ${GRADIENT_BLOCK} ${TO_NDC} struct VertexInput { @location(0) position: vec2<f32>, @location(1) fill_color: vec4<f32>, } struct VertexOutput { @builtin(position) pos: vec4<f32>, @location(0) world: vec2<f32>, @location(1) fill: vec4<f32>, } @vertex fn main_vertex(model: VertexInput) -> VertexOutput { let ndc = toNdc(model.position - uniforms.offset, uniforms.resolution); var output: VertexOutput; output.pos = vec4<f32>(ndc, 0.0, 1.0); output.world = model.position; output.fill = model.fill_color; return output; } fn fragmentColor(in: VertexOutput) -> vec4<f32> { let sample = rampAt(in.world); return vec4<f32>(sample.rgb, sample.a * in.fill.a); } ${fragmentTail(blend)} `;

    /** One instanced quad per image, sampling the decoded bitmap. */
    const imageShader = (blend) => ` ${uniformBlock()} @group(1) @binding(0) var imageSampler: sampler; @group(1) @binding(1) var imageTexture: texture_2d<f32>; ${TO_NDC} struct VertexInput { @location(0) position: vec2<f32>, } struct InstanceInput { @location(1) origin: vec2<f32>, @location(2) size: vec2<f32>, @location(3) opacity: f32, } struct VertexOutput { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32>, @location(1) opacity: f32, } @vertex fn main_vertex(model: VertexInput, instance: InstanceInput) -> VertexOutput { let p = model.position * instance.size + instance.origin - uniforms.offset; var output: VertexOutput; output.pos = vec4<f32>(toNdc(p, uniforms.resolution), 0.0, 1.0); output.uv = model.position; output.opacity = instance.opacity; return output; } ${UNPREMULTIPLY} fn fragmentColor(in: VertexOutput) -> vec4<f32> { let color = textureSample(imageTexture, imageSampler, in.uv); return vec4<f32>(unpremultiply(color), color.a * in.opacity); } ${fragmentTail(blend)} `;

    /**
     * Paints one colour through a coverage mask, over the box the mask was drawn
     * in.
     *
     * A stroke whose own bands overlap cannot be composited band by band: two
     * antialiased fringes landing on one pixel compose to more than the union
     * canvas fills once, which reads as a dark seam at every joint. The bands go
     * into the mask first, where the pass keeps the largest value on each pixel,
     * and this draws the result in a single composite.
     *
     * The mask is single sampled and the frame may not be, so the coverage is read
     * by whole texel at the pixel centre rather than sampled.
     */
    const maskCompositeShader = (blend) => ` ${uniformBlock()} struct MaskParams { color: vec4<f32>, rect: vec4<f32>, } @group(1) @binding(0) var maskTexture: texture_2d<f32>; @group(1) @binding(1) var<uniform> mask: MaskParams; ${TO_NDC} struct VertexOutput { @builtin(position) pos: vec4<f32>, } @vertex fn main_vertex(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput { var corners = ${UNIT_QUAD}; let p = mask.rect.xy + corners[vertexIndex] * mask.rect.zw - uniforms.offset; var out: VertexOutput; out.pos = vec4<f32>(toNdc(p, uniforms.resolution), 0.0, 1.0); return out; } fn fragmentColor(in: VertexOutput) -> vec4<f32> { let cover = textureLoad(maskTexture, vec2<i32>(in.pos.xy), 0).r; return vec4<f32>(mask.color.rgb, cover); } ${fragmentTail(blend)} `;

    /**
     * Rects and group backgrounds: one instanced quad each, with coverage computed
     * analytically so two abutting rects leave the faint seam canvas leaves rather
     * than a whole missing MSAA sample. Also carries the gradient-filled variant,
     * which shares the geometry and differs only in where the fill comes from.
     */
    const rectShader = (blend) => ` ${uniformBlock()} ${GRADIENT_BLOCK} ${TO_NDC} ${FILL_STROKE_SHARE} ${BOX_COVERAGE} struct VertexInput { @location(0) position: vec2<f32>, } struct InstanceInput { @location(1) center: vec2<f32>, @location(2) scale: vec2<f32>, @location(3) fill_color: vec4<f32>, @location(4) stroke_color: vec4<f32>, @location(5) strokewidth: f32, @location(6) corner_radii: vec4<f32>, } struct VertexOutput { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32>, @location(1) fill: vec4<f32>, @location(2) stroke: vec4<f32>, @location(3) strokewidth: f32, @location(4) corner_radii: vec4<f32>, @location(5) scale: vec2<f32>, @location(6) lo_dev: vec2<f32>, @location(7) hi_dev: vec2<f32>, } @vertex fn main_vertex(model: VertexInput, instance: InstanceInput) -> VertexOutput { let d = dpi(); let sw = vec2<f32>(instance.strokewidth, instance.strokewidth); let size = instance.scale + sw; let lo = instance.center - uniforms.offset - sw / 2.0; let hi = lo + size; let pad = vec2<f32>(1.0, 1.0) / d; let p = mix(lo - pad, hi + pad, model.position); var output: VertexOutput; output.pos = vec4<f32>(toNdc(p, uniforms.resolution), 0.0, 1.0); let uv = (p - lo) / max(size, vec2<f32>(1e-6, 1e-6)); output.uv = vec2<f32>(uv.x, 1.0 - uv.y); output.fill = instance.fill_color; output.stroke = instance.stroke_color; output.strokewidth = instance.strokewidth; output.corner_radii = instance.corner_radii; output.scale = instance.scale; output.lo_dev = lo * d; output.hi_dev = hi * d; return output; } fn sdRoundedRect(p: vec2<f32>, b: vec2<f32>, radii: vec4<f32>) -> f32 { var r = select( select(radii.z, radii.w, p.y > 0.0), select(radii.y, radii.x, p.y > 0.0), p.x > 0.0, ); r = min(r, min(b.x, b.y)); let q = abs(p) - b + vec2<f32>(r, r); return length(max(q, vec2<f32>(0.0, 0.0))) + min(max(q.x, q.y), 0.0) - r; } fn roundedRectColor(in: VertexOutput, fill: vec4<f32>) -> vec4<f32> { let p = (in.uv - vec2<f32>(0.5, 0.5)) * (in.scale + vec2<f32>(in.strokewidth, in.strokewidth)); let scale = dpi(); let d = sdRoundedRect(p, in.scale * 0.5, in.corner_radii) * scale; let half_sw = in.strokewidth * 0.5 * scale; let aa = 0.75; let outer = 1.0 - smoothstep(half_sw - aa, half_sw + aa, d); let inner = 1.0 - smoothstep(-half_sw - aa, -half_sw + aa, d); let fillCov = 1.0 - smoothstep(-aa, aa, d); return fillStrokeShare(fill, in.stroke, fillCov, max(outer - inner, 0.0)); } fn straightRectColor(in: VertexOutput, fill: vec4<f32>) -> vec4<f32> { let p = in.pos.xy; let sw = vec2<f32>(in.strokewidth, in.strokewidth) * dpi(); let outer = boxCoverage(p, in.lo_dev, in.hi_dev); let inner = boxCoverage(p, in.lo_dev + sw, in.hi_dev - sw); return fillStrokeShare(fill, in.stroke, outer, max(outer - inner, 0.0)); } fn maxRadius(radii: vec4<f32>) -> f32 { return max(max(radii.x, radii.y), max(radii.z, radii.w)); } fn rectColor(in: VertexOutput, fill: vec4<f32>) -> vec4<f32> { if maxRadius(in.corner_radii) <= 0.0 { return straightRectColor(in, fill); } return roundedRectColor(in, fill); } fn fragmentColor(in: VertexOutput) -> vec4<f32> { return rectColor(in, in.fill); } fn gradientColor(in: VertexOutput) -> vec4<f32> { let sample = rampAt(in.pos.xy / dpi() + uniforms.offset); return rectColor(in, vec4<f32>(sample.rgb, sample.a * in.fill.a)); } ${fragmentTail(blend, { main_fragment: 'fragmentColor', main_fragment_gradient: 'gradientColor' })} `;

    /**
     * Axis-aligned rules, drawn as one instanced quad with analytic coverage. MSAA
     * quantizes a 1px rule to whole samples, so it reads as one hard column instead
     * of the soft two canvas draws.
     */
    const ruleShader = (blend) => ` ${uniformBlock()} ${TO_NDC} ${BOX_COVERAGE} struct VertexInput { @location(0) position: vec2<f32>, @location(1) center: vec2<f32>, @location(2) scale: vec2<f32>, @location(3) stroke_color: vec4<f32>, @location(4) axis_offset: vec2<f32>, } struct VertexOutput { @builtin(position) pos: vec4<f32>, @location(1) stroke: vec4<f32>, @location(2) lo_dev: vec2<f32>, @location(3) hi_dev: vec2<f32>, } @vertex fn main_vertex(in: VertexInput) -> VertexOutput { let d = dpi(); let lo = in.center - uniforms.offset - in.axis_offset; let hi = lo + in.scale; let pad = vec2<f32>(1.0, 1.0) / d; let p = mix(lo - pad, hi + pad, in.position); var output: VertexOutput; output.pos = vec4<f32>(toNdc(p, uniforms.resolution), 0.0, 1.0); output.stroke = in.stroke_color; output.lo_dev = lo * d; output.hi_dev = hi * d; return output; } fn fragmentColor(in: VertexOutput) -> vec4<f32> { return vec4<f32>(in.stroke.rgb, in.stroke.a * boxCoverage(in.pos.xy, in.lo_dev, in.hi_dev)); } ${fragmentTail(blend)} `;

    /**
     * One quad per line segment instance, with the coverage of the segment computed
     * analytically. Dashes, dashed rect borders, diagonal rules, shape outlines and
     * line segments all come through here.
     *
     * Each end carries how it finishes: a flat cut, a round cap, or a join, as the
     * outward bisector of the corner and how far along it the outer corner reaches.
     * Both segments at a vertex get the same bisector and keep opposite sides of
     * it, so their union is the joined outline with no overlap between them.
     */
    const slineShader = (blend) => ` ${uniformBlock()} ${GRADIENT_BLOCK} ${TO_NDC} ${SEGMENT_NORMAL} struct VertexInput { @location(0) start: vec2<f32>, @location(1) end: vec2<f32>, @location(2) color: vec4<f32>, @location(3) stroke_width: f32, @location(4) join_start: vec4<f32>, @location(5) join_end: vec4<f32>, @location(6) reach: vec2<f32>, } struct VertexOutput { @builtin(position) pos: vec4<f32>, @location(0) fill: vec4<f32>, @location(1) a_dev: vec2<f32>, @location(2) b_dev: vec2<f32>, @location(3) half_dev: f32, @location(4) @interpolate(flat) join_start: vec4<f32>, @location(5) @interpolate(flat) join_end: vec4<f32>, @location(6) world: vec2<f32>, @location(7) @interpolate(flat) reach: vec2<f32>, } const END_BUTT: f32 = ${KIND_BUTT.toFixed(1)}; const END_ROUND_CAP: f32 = ${KIND_ROUND_CAP.toFixed(1)}; const END_ROUND_JOIN: f32 = ${KIND_ROUND_JOIN.toFixed(1)}; const END_MITER: f32 = ${KIND_MITER.toFixed(1)}; const END_BEVEL: f32 = ${KIND_BEVEL.toFixed(1)}; const END_CAP_MEET: f32 = ${KIND_CAP_MEET.toFixed(1)}; fn endReach(join: vec4<f32>, half_w: f32, outward: vec2<f32>) -> f32 { let kind = join.w; if kind == END_BUTT { return 0.0; } if kind == END_ROUND_CAP || kind == END_ROUND_JOIN || kind == END_CAP_MEET { return half_w; } return max(join.z * dot(join.xy, outward), 0.0); } @vertex fn main_vertex(in: VertexInput, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput { let d = dpi(); let delta = in.end - in.start; let direction = safeDirection(delta); let normal = normalAt(delta); let pad = 1.0 / d; let half = in.stroke_width * 0.5; let side = normal * (half + pad); let behind = direction * (pad + endReach(in.join_start, half, -direction)); let ahead = direction * (pad + endReach(in.join_end, half, direction)); let p1 = in.start - side - behind; let p2 = in.start + side - behind; let p3 = in.end - side + ahead; let p4 = in.end + side + ahead; var vertices = array(p1, p2, p3, p4, p2, p3); let ndc = toNdc(vertices[vertexIndex] - uniforms.offset, uniforms.resolution); var out: VertexOutput; out.pos = vec4<f32>(ndc, 0.0, 1.0); out.world = vertices[vertexIndex]; out.fill = in.color; out.a_dev = (in.start - uniforms.offset) * d; out.b_dev = (in.end - uniforms.offset) * d; out.half_dev = half * d; out.join_start = vec4<f32>(in.join_start.xy, in.join_start.z * d, in.join_start.w); out.join_end = vec4<f32>(in.join_end.xy, in.join_end.z * d, in.join_end.w); out.reach = in.reach * d; return out; } fn endFactor(v: vec2<f32>, outward: vec2<f32>, join: vec4<f32>, half_w: f32, reach: f32) -> f32 { let kind = join.w; if kind == END_ROUND_CAP { return 1.0; } if kind == END_BUTT { return clamp(0.5 - dot(v, outward), 0.0, 1.0); } let m = join.xy; if kind == END_CAP_MEET { if dot(v, m) <= join.z { return 1.0; } if dot(v, outward) > 0.0 { return 0.0; } return select(1.0, 0.0, length(v - m * (join.z * 2.0)) < half_w - 0.5); } let outer = select(1.0, clamp(0.5 + join.z - dot(v, m), 0.0, 1.0), kind == END_BEVEL); if dot(v, outward) <= 0.0 { let other = outward - 2.0 * dot(outward, m) * m; if dot(v, other) > reach { return outer; } } var n = vec2<f32>(-m.y, m.x); let flipped = dot(n, outward) < 0.0; if flipped { n = -n; } let side = dot(v, n); if select(side > 0.0, side >= 0.0, flipped) { return 0.0; } return outer; } fn runsOn(join: vec4<f32>) -> bool { return join.w == END_MITER || join.w == END_BEVEL; } fn fragmentColor(in: VertexOutput) -> vec4<f32> { let ab = in.b_dev - in.a_dev; let len = length(ab); let e = safeDirection(ab); let v = in.pos.xy - in.a_dev; let along = dot(v, e); let lo = select(0.0, -1e6, runsOn(in.join_start)); let hi = select(len, 1e6, runsOn(in.join_end)); let dist = length(v - e * clamp(along, lo, hi)); let cover = clamp(in.half_dev - dist + 0.5, 0.0, 1.0) - clamp(-in.half_dev - dist + 0.5, 0.0, 1.0); let behind = endFactor(v, -e, in.join_start, in.half_dev, in.reach.x); let ahead = endFactor(in.pos.xy - in.b_dev, e, in.join_end, in.half_dev, in.reach.y); return vec4<f32>(in.fill.rgb, in.fill.a * cover * behind * ahead); } fn gradientColor(in: VertexOutput) -> vec4<f32> { let solid = fragmentColor(in); let ramp = rampAt(in.world); return vec4<f32>(ramp.rgb, ramp.a * solid.a); } ${fragmentTail(blend, { main_fragment: 'fragmentColor', main_fragment_gradient: 'gradientColor' })} @fragment fn main_fragment_mask(in: VertexOutput) -> @location(0) vec4<f32> { if clipCoverage(in.pos.xy) <= 0.0 { discard; } return vec4<f32>(fragmentColor(in).a, 0.0, 0.0, 1.0); } `;

    /**
     * Triangulated geometry with a colour per vertex, which is what the area, path
     * and shape marks all reduce to once their contours are tessellated.
     */
    const solidFillShader = (blend) => ` ${uniformBlock()} ${TO_NDC} struct VertexInput { @location(0) position: vec2<f32>, @location(1) fill_color: vec4<f32>, } struct VertexOutput { @builtin(position) pos: vec4<f32>, @location(0) fill: vec4<f32>, } @vertex fn main_vertex(model: VertexInput) -> VertexOutput { let ndc = toNdc(model.position - uniforms.offset, uniforms.resolution); var output: VertexOutput; output.pos = vec4<f32>(ndc, 0.0, 1.0); output.fill = model.fill_color; return output; } fn fragmentColor(in: VertexOutput) -> vec4<f32> { return in.fill; } ${fragmentTail(blend)} @fragment fn main_fragment_mask(in: VertexOutput) -> @location(0) vec4<f32> { return vec4<f32>(in.fill.a * clipCoverage(in.pos.xy), 0.0, 0.0, 1.0); } `;

    /** Analytic circles: one instanced quad per symbol, edge and stroke by distance. */
    const symbolShader = (blend) => ` ${uniformBlock()} ${TO_NDC} ${FILL_STROKE_SHARE} struct VertexInput { @location(0) position: vec2<f32>, } struct InstanceInput { @location(1) center: vec2<f32>, @location(2) radius: f32, @location(3) fill_color: vec4<f32>, @location(4) stroke_color: vec4<f32>, @location(5) stroke_width: f32, } struct VertexOutput { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32>, @location(1) fill: vec4<f32>, @location(2) stroke_color: vec4<f32>, @location(3) radius: f32, @location(4) stroke_width: f32, @location(5) geom_radius: f32, } const pad = 1.0; @vertex fn main_vertex(model: VertexInput, instance: InstanceInput) -> VertexOutput { let geom_radius = instance.radius + instance.stroke_width * 0.5 + pad; let p = model.position * geom_radius + instance.center - uniforms.offset; var output: VertexOutput; output.pos = vec4<f32>(toNdc(p, uniforms.resolution), 0.0, 1.0); output.uv = model.position * 0.5 + vec2<f32>(0.5, 0.5); output.fill = instance.fill_color; output.stroke_color = instance.stroke_color; output.radius = instance.radius; output.stroke_width = instance.stroke_width; output.geom_radius = geom_radius; return output; } fn fragmentColor(in: VertexOutput) -> vec4<f32> { let d = distance(in.uv, vec2<f32>(0.5, 0.5)) * 2.0 * in.geom_radius; let scale = dpi(); let half_sw = in.stroke_width * 0.5; let outer = clamp(0.5 - (d - in.radius - half_sw) * scale, 0.0, 1.0); let inner = clamp(0.5 - (d - in.radius + half_sw) * scale, 0.0, 1.0); let fillCov = clamp(0.5 - (d - in.radius) * scale, 0.0, 1.0); return fillStrokeShare(in.fill, in.stroke_color, fillCov, max(outer - inner, 0.0)); } ${fragmentTail(blend)} `;

    const SHAPE_SDF = {
        square: {
            sdf: '    return sdBox(p, vec2<f32>(s * 0.5 + inflate, s * 0.5 + inflate));',
            reach: 0.70710678,
            miter: 1.41421356,
        },
        // vertices sit at s/2 on each axis, and moving both edges out by `inflate`
        // raises the |x| + |y| threshold by inflate * sqrt(2)
        diamond: {
            sdf: '    return (abs(p.x) + abs(p.y) - (s * 0.5 + inflate * 1.41421356)) * 0.70710678;',
            reach: 0.5,
            miter: 1.41421356,
        },
        'triangle-up': {
            sdf: ` return sdTriangleInflated(p, vec2<f32>(0.0, -0.433 * s), vec2<f32>(-0.5 * s, 0.433 * s), vec2<f32>(0.5 * s, 0.433 * s), inflate);`,
            reach: 0.57735,
            miter: 2,
        },
        'triangle-down': {
            sdf: ` return sdTriangleInflated(p, vec2<f32>(0.0, 0.433 * s), vec2<f32>(0.5 * s, -0.433 * s), vec2<f32>(-0.5 * s, -0.433 * s), inflate);`,
            reach: 0.57735,
            miter: 2,
        },
        'triangle-right': {
            sdf: ` return sdTriangleInflated(p, vec2<f32>(0.433 * s, 0.0), vec2<f32>(-0.433 * s, 0.5 * s), vec2<f32>(-0.433 * s, -0.5 * s), inflate);`,
            reach: 0.57735,
            miter: 2,
        },
        'triangle-left': {
            sdf: ` return sdTriangleInflated(p, vec2<f32>(-0.433 * s, 0.0), vec2<f32>(0.433 * s, -0.5 * s), vec2<f32>(0.433 * s, 0.5 * s), inflate);`,
            reach: 0.57735,
            miter: 2,
        },
        triangle: {
            sdf: ` return sdTriangleInflated(p, vec2<f32>(0.0, -0.5774 * s), vec2<f32>(-0.5 * s, 0.2887 * s), vec2<f32>(0.5 * s, 0.2887 * s), inflate);`,
            reach: 0.57735,
            miter: 2,
        },
        // vega draws a wedge as an isosceles triangle a quarter as wide as a triangle,
        // so its tip is sharp enough that a miter carries it seven half widths out
        wedge: {
            sdf: ` return sdTriangleInflated(p, vec2<f32>(0.0, -0.57735 * s), vec2<f32>(-0.125 * s, 0.288675 * s), vec2<f32>(0.125 * s, 0.288675 * s), inflate);`,
            reach: 0.7578,
            miter: 7.01,
        },
        // a shaft box under a head triangle, and dilating a union is the union of the
        // dilations, so the outer stroke edge is exact
        arrow: {
            sdf: ` let shaft = sdBox(p - vec2<f32>(0.0, 0.21875 * s), vec2<f32>(0.071429 * s + inflate, 0.28125 * s + inflate)); let head = sdTriangleInflated(p, vec2<f32>(0.2 * s, -0.0625 * s), vec2<f32>(0.0, -0.5 * s), vec2<f32>(-0.2 * s, -0.0625 * s), inflate); return min(shaft, head);`,
            reach: 0.5051,
            miter: 2.41,
        },
    };
    /** True when the shape has a distance function and can skip triangulation. */
    function hasSdf(shape) {
        return Object.hasOwn(SHAPE_SDF, shape);
    }
    /**
     * One shader per shape rather than one shader switching on a shape id, so the
     * fragment stays branchless.
     */
    const symbolSdfShader = (blend, shape) => {
        const spec = shape === undefined ? undefined : SHAPE_SDF[shape];
        if (spec === undefined) {
            throw new Error(`[vega-webgpu] No distance function for symbol shape '${shape}'.`);
        }
        return ` ${uniformBlock()} ${TO_NDC} ${FILL_STROKE_SHARE} struct VertexInput { @location(0) position: vec2<f32>, } struct InstanceInput { @location(1) center: vec2<f32>, @location(2) size: f32, @location(3) fill_color: vec4<f32>, @location(4) stroke_color: vec4<f32>, @location(5) stroke_width: f32, @location(6) angle: f32, } struct VertexOutput { @builtin(position) pos: vec4<f32>, @location(0) local: vec2<f32>, @location(1) fill: vec4<f32>, @location(2) stroke: vec4<f32>, @location(3) size: f32, @location(4) stroke_width: f32, } fn sdTriangle(p: vec2<f32>, p0: vec2<f32>, p1: vec2<f32>, p2: vec2<f32>) -> f32 { let e0 = p1 - p0; let e1 = p2 - p1; let e2 = p0 - p2; let v0 = p - p0; let v1 = p - p1; let v2 = p - p2; let pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0); let pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0); let pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0); let s = sign(e0.x * e2.y - e0.y * e2.x); let d = min( min( vec2<f32>(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)), vec2<f32>(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x)), ), vec2<f32>(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)), ); return -sqrt(d.x) * sign(d.y); } fn sdBox(p: vec2<f32>, b: vec2<f32>) -> f32 { let d = abs(p) - b; return length(max(d, vec2<f32>(0.0, 0.0))) + min(max(d.x, d.y), 0.0); } fn sdTriangleInflated(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>, c: vec2<f32>, inflate: f32) -> f32 { let la = distance(b, c); let lb = distance(a, c); let lc = distance(a, b); let perimeter = la + lb + lc; let incentre = (la * a + lb * b + lc * c) / perimeter; let area = abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) * 0.5; let inradius = area / max(perimeter * 0.5, 1e-6); let k = 1.0 + inflate / max(inradius, 1e-6); return sdTriangle(p, incentre + (a - incentre) * k, incentre + (b - incentre) * k, incentre + (c - incentre) * k); } fn shapeDistance(p: vec2<f32>, s: f32, inflate: f32) -> f32 { ${spec.sdf} } fn shapeExtent(s: f32, half_width: f32) -> f32 { return ${spec.reach} * s + ${spec.miter} * half_width + 1.0; } @vertex fn main_vertex(model: VertexInput, instance: InstanceInput) -> VertexOutput { let extent = shapeExtent(instance.size, instance.stroke_width * 0.5); let local = model.position * extent; let c = cos(instance.angle); let sn = sin(instance.angle); let rotated = vec2<f32>(local.x * c - local.y * sn, local.x * sn + local.y * c); var output: VertexOutput; output.pos = vec4<f32>(toNdc(rotated + instance.center - uniforms.offset, uniforms.resolution), 0.0, 1.0); output.local = local; output.fill = instance.fill_color; output.stroke = instance.stroke_color; output.size = instance.size; output.stroke_width = instance.stroke_width; return output; } fn fragmentColor(in: VertexOutput) -> vec4<f32> { let d = dpi(); let half_sw = in.stroke_width * 0.5; let outer = clamp(0.5 - shapeDistance(in.local, in.size, half_sw) * d, 0.0, 1.0); let inner = clamp(0.5 - shapeDistance(in.local, in.size, -half_sw) * d, 0.0, 1.0); let fillCov = clamp(0.5 - shapeDistance(in.local, in.size, 0.0) * d, 0.0, 1.0); return fillStrokeShare(in.fill, in.stroke, fillCov, max(outer - inner, 0.0)); } ${fragmentTail(blend)} `;
    };

    /**
     * Instanced triangulated symbol shapes: one triangulated geometry per
     * (shape, size), placed and coloured per instance. Shapes with a closed form go
     * through symbolSdf and circles through symbol. Everything else comes here.
     */
    const symbolShapeShader = (blend) => ` ${uniformBlock()} ${TO_NDC} struct VertexInput { @location(0) position: vec2<f32>, } struct InstanceInput { @location(1) center: vec2<f32>, @location(2) color: vec4<f32>, @location(3) angle: f32, } struct VertexOutput { @builtin(position) pos: vec4<f32>, @location(0) color: vec4<f32>, } @vertex fn main_vertex(model: VertexInput, instance: InstanceInput) -> VertexOutput { let c = cos(instance.angle); let s = sin(instance.angle); let rotated = vec2<f32>(model.position.x * c - model.position.y * s, model.position.x * s + model.position.y * c); let ndc = toNdc(rotated + instance.center - uniforms.offset, uniforms.resolution); var output: VertexOutput; output.pos = vec4<f32>(ndc, 0.0, 1.0); output.color = instance.color; return output; } fn fragmentColor(in: VertexOutput) -> vec4<f32> { return in.color; } ${fragmentTail(blend)} `;

    /**
     * One quad per label, sampling the sub-rect it was packed into on the atlas.
     * The glyph is rasterized upright, so a rotated label turns its quad about the
     * anchor instead.
     */
    const textShader = (blend) => ` ${uniformBlock()} @group(1) @binding(0) var texSampler: sampler; @group(1) @binding(1) var tex: texture_2d<f32>; ${TO_NDC} struct VertexInput { @location(0) rect: vec4<f32>, @location(1) uv: vec4<f32>, @location(2) turn: vec4<f32>, @location(3) opacity: f32, } struct VertexOutput { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32>, @location(1) opacity: f32, } @vertex fn main_vertex(in: VertexInput, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput { var corners = ${UNIT_QUAD}; let c = corners[vertexIndex]; var p = mix(in.rect.xy, in.rect.zw, c); if (in.turn.w != 0.0 || in.turn.z != 1.0) { let d = p - in.turn.xy; p = in.turn.xy + vec2<f32>(d.x * in.turn.z - d.y * in.turn.w, d.x * in.turn.w + d.y * in.turn.z); } var output: VertexOutput; output.pos = vec4<f32>(toNdc(p - uniforms.offset, uniforms.resolution), 0.0, 1.0); output.uv = mix(in.uv.xy, in.uv.zw, c); output.opacity = in.opacity; return output; } ${UNPREMULTIPLY} fn fragmentColor(in: VertexOutput) -> vec4<f32> { let c = textureSample(tex, texSampler, in.uv); return vec4<f32>(unpremultiply(c), c.a * in.opacity); } ${fragmentTail(blend)} `;

    /** Every shader source, by the name marks ask for. */
    const BUILDERS = {
        BlendComposite: blendCompositeShader,
        Curve: curveShader,
        GradientFill: gradientFillShader,
        Image: imageShader,
        MaskComposite: maskCompositeShader,
        Rect: rectShader,
        Rule: ruleShader,
        SLine: slineShader,
        SolidFill: solidFillShader,
        Symbol: symbolShader,
        SymbolSdf: symbolSdfShader,
        SymbolShape: symbolShapeShader,
        Text: textShader,
    };
    /**
     * The compiled module for one shader variant, built on first use and cached on
     * the context for the life of the device. `key` names a builder, optionally
     * followed by a sub-variant after a colon.
     *
     * Building on demand rather than up front matters: a chart uses a handful of
     * these, and compiling every blend mode of every shader would put the cost of
     * shaders nobody draws into the first frame.
     */
    function shaderModule(ctx, device, key, blend) {
        const cacheKey = `${key}|${blend}`;
        const cached = ctx._shaderCache[cacheKey];
        if (cached) {
            return cached;
        }
        const sep = key.indexOf(':');
        const build = BUILDERS[(sep < 0 ? key : key.slice(0, sep))];
        const shader = device.createShaderModule({
            code: build(blend, sep < 0 ? undefined : key.slice(sep + 1)),
            label: `${cacheKey} Shader`,
        });
        ctx._shaderCache[cacheKey] = shader;
        return shader;
    }

    /** Factory helpers for the WebGPU objects shared by all mark renderers. */
    /**
     * By default rendering goes through a 4x multisampled attachment (guaranteed
     * to be supported by WebGPU) that is resolved into the canvas, so geometric
     * edges of triangulated marks get antialiased without per-shader work.
     * `wgOptions.sampleCount = 1` renders directly into the canvas instead.
     */
    const defaultSampleCount = 4;
    /** WebGPU render attachments only support 1 or 4 samples portably. */
    function normalizeSampleCount(value) {
        if (value === 1 || value === 4) {
            return value;
        }
        warnOnce('sampleCount', `[vega-webgpu] Unsupported sampleCount ${value}; only 1 or 4 are supported. Using ${defaultSampleCount}.`);
        return defaultSampleCount;
    }
    function preferredColorFormat() {
        return typeof navigator !== 'undefined' && navigator.gpu ? navigator.gpu.getPreferredCanvasFormat() : 'bgra8unorm';
    }
    function createRenderPipeline(name, device, shader, format, sampleCount, buffers, blend, fragmentEntryPoint = 'main_fragment') {
        return device.createRenderPipeline({
            label: `${name} Render Pipeline`,
            layout: 'auto',
            vertex: {
                module: shader,
                entryPoint: 'main_vertex',
                buffers,
            },
            fragment: {
                module: shader,
                entryPoint: fragmentEntryPoint,
                targets: [{ format, blend }],
            },
            primitive: {
                topology: 'triangle-list',
            },
            multisample: {
                count: sampleCount,
            },
        });
    }
    const layouts = new WeakMap();
    /**
     * A pipeline's bind group layout at `index`. Every bind group made for the
     * pipeline needs it, and asking the pipeline makes a new one each time.
     */
    function bindGroupLayout(pipeline, index) {
        let held = layouts.get(pipeline);
        if (!held) {
            held = [];
            layouts.set(pipeline, held);
        }
        return (held[index] ??= pipeline.getBindGroupLayout(index));
    }
    const views = new WeakMap();
    /** A texture's default view, made once rather than for every pass or bind group. */
    function viewOf(texture) {
        let view = views.get(texture);
        if (!view) {
            view = texture.createView();
            views.set(texture, view);
        }
        return view;
    }
    /**
     * The group 0 bind group every mark pipeline takes: the shared uniform block
     * and the clip path's coverage.
     *
     * The mask is not optional. Every shader built on `uniformBlock` declares it
     * and every fragment entry reads it, so a call that left it out would build a
     * bind group short of an entry the layout has, and WebGPU throws out the whole
     * command buffer for that: the frame comes out blank and the reason goes to
     * `onuncapturederror` rather than failing anything. `clipMaskView` hands back
     * a placeholder where there is no clip, so there is always one to pass.
     */
    function createUniformBindGroup(name, device, pipeline, uniforms, clipMask) {
        return device.createBindGroup({
            label: `${name} Uniform Bind Group`,
            layout: bindGroupLayout(pipeline, 0),
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: uniforms,
                    },
                },
                { binding: 1, resource: clipMask },
            ],
        });
    }
    const linearSamplers = new WeakMap();
    /** The bilinear, edge-clamped sampler text and gradient ramps read through. */
    function linearSampler(device) {
        let sampler = linearSamplers.get(device);
        if (!sampler) {
            sampler = device.createSampler({
                label: 'Linear Sampler',
                magFilter: 'linear',
                minFilter: 'linear',
                addressModeU: 'clamp-to-edge',
                addressModeV: 'clamp-to-edge',
            });
            linearSamplers.set(device, sampler);
        }
        return sampler;
    }
    /** The group 1 bind group of a textured pipeline: its sampler and its texture. */
    function textureBindGroup(device, label, pipeline, sampler, view) {
        return device.createBindGroup({
            label,
            layout: bindGroupLayout(pipeline, 1),
            entries: [
                { binding: 0, resource: sampler },
                { binding: 1, resource: view },
            ],
        });
    }
    /** A texture an image or a rasterized label is copied into. */
    function imageTexture(device, label, width, height, mipLevelCount = 1) {
        return device.createTexture({
            label,
            size: [width, height, 1],
            mipLevelCount,
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });
    }
    /**
     * Copies a region of a canvas or bitmap into a texture, kept premultiplied.
     * Straight alpha turns a fully transparent texel black, and filtering then
     * drags the colour next to it toward that, darkening the edge. The shaders
     * divide the alpha back out after sampling.
     */
    function uploadImage(device, source, texture, width, height, origin = [0, 0], mipLevel = 0) {
        device.queue.copyExternalImageToTexture({ source, origin }, { texture, origin, mipLevel, premultipliedAlpha: true }, [
            width,
            height,
        ]);
    }

    function define(constructor, factory, prototype) {
      constructor.prototype = factory.prototype = prototype;
      prototype.constructor = constructor;
    }

    function extend(parent, definition) {
      var prototype = Object.create(parent.prototype);
      for (var key in definition) prototype[key] = definition[key];
      return prototype;
    }

    function Color$1() {}

    var darker = 0.7;
    var brighter = 1 / darker;

    var reI = "\\s*([+-]?\\d+)\\s*",
        reN = "\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)\\s*",
        reP = "\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)%\\s*",
        reHex = /^#([0-9a-f]{3,8})$/,
        reRgbInteger = new RegExp(`^rgb\\(${reI},${reI},${reI}\\)$`),
        reRgbPercent = new RegExp(`^rgb\\(${reP},${reP},${reP}\\)$`),
        reRgbaInteger = new RegExp(`^rgba\\(${reI},${reI},${reI},${reN}\\)$`),
        reRgbaPercent = new RegExp(`^rgba\\(${reP},${reP},${reP},${reN}\\)$`),
        reHslPercent = new RegExp(`^hsl\\(${reN},${reP},${reP}\\)$`),
        reHslaPercent = new RegExp(`^hsla\\(${reN},${reP},${reP},${reN}\\)$`);

    var named = {
      aliceblue: 0xf0f8ff,
      antiquewhite: 0xfaebd7,
      aqua: 0x00ffff,
      aquamarine: 0x7fffd4,
      azure: 0xf0ffff,
      beige: 0xf5f5dc,
      bisque: 0xffe4c4,
      black: 0x000000,
      blanchedalmond: 0xffebcd,
      blue: 0x0000ff,
      blueviolet: 0x8a2be2,
      brown: 0xa52a2a,
      burlywood: 0xdeb887,
      cadetblue: 0x5f9ea0,
      chartreuse: 0x7fff00,
      chocolate: 0xd2691e,
      coral: 0xff7f50,
      cornflowerblue: 0x6495ed,
      cornsilk: 0xfff8dc,
      crimson: 0xdc143c,
      cyan: 0x00ffff,
      darkblue: 0x00008b,
      darkcyan: 0x008b8b,
      darkgoldenrod: 0xb8860b,
      darkgray: 0xa9a9a9,
      darkgreen: 0x006400,
      darkgrey: 0xa9a9a9,
      darkkhaki: 0xbdb76b,
      darkmagenta: 0x8b008b,
      darkolivegreen: 0x556b2f,
      darkorange: 0xff8c00,
      darkorchid: 0x9932cc,
      darkred: 0x8b0000,
      darksalmon: 0xe9967a,
      darkseagreen: 0x8fbc8f,
      darkslateblue: 0x483d8b,
      darkslategray: 0x2f4f4f,
      darkslategrey: 0x2f4f4f,
      darkturquoise: 0x00ced1,
      darkviolet: 0x9400d3,
      deeppink: 0xff1493,
      deepskyblue: 0x00bfff,
      dimgray: 0x696969,
      dimgrey: 0x696969,
      dodgerblue: 0x1e90ff,
      firebrick: 0xb22222,
      floralwhite: 0xfffaf0,
      forestgreen: 0x228b22,
      fuchsia: 0xff00ff,
      gainsboro: 0xdcdcdc,
      ghostwhite: 0xf8f8ff,
      gold: 0xffd700,
      goldenrod: 0xdaa520,
      gray: 0x808080,
      green: 0x008000,
      greenyellow: 0xadff2f,
      grey: 0x808080,
      honeydew: 0xf0fff0,
      hotpink: 0xff69b4,
      indianred: 0xcd5c5c,
      indigo: 0x4b0082,
      ivory: 0xfffff0,
      khaki: 0xf0e68c,
      lavender: 0xe6e6fa,
      lavenderblush: 0xfff0f5,
      lawngreen: 0x7cfc00,
      lemonchiffon: 0xfffacd,
      lightblue: 0xadd8e6,
      lightcoral: 0xf08080,
      lightcyan: 0xe0ffff,
      lightgoldenrodyellow: 0xfafad2,
      lightgray: 0xd3d3d3,
      lightgreen: 0x90ee90,
      lightgrey: 0xd3d3d3,
      lightpink: 0xffb6c1,
      lightsalmon: 0xffa07a,
      lightseagreen: 0x20b2aa,
      lightskyblue: 0x87cefa,
      lightslategray: 0x778899,
      lightslategrey: 0x778899,
      lightsteelblue: 0xb0c4de,
      lightyellow: 0xffffe0,
      lime: 0x00ff00,
      limegreen: 0x32cd32,
      linen: 0xfaf0e6,
      magenta: 0xff00ff,
      maroon: 0x800000,
      mediumaquamarine: 0x66cdaa,
      mediumblue: 0x0000cd,
      mediumorchid: 0xba55d3,
      mediumpurple: 0x9370db,
      mediumseagreen: 0x3cb371,
      mediumslateblue: 0x7b68ee,
      mediumspringgreen: 0x00fa9a,
      mediumturquoise: 0x48d1cc,
      mediumvioletred: 0xc71585,
      midnightblue: 0x191970,
      mintcream: 0xf5fffa,
      mistyrose: 0xffe4e1,
      moccasin: 0xffe4b5,
      navajowhite: 0xffdead,
      navy: 0x000080,
      oldlace: 0xfdf5e6,
      olive: 0x808000,
      olivedrab: 0x6b8e23,
      orange: 0xffa500,
      orangered: 0xff4500,
      orchid: 0xda70d6,
      palegoldenrod: 0xeee8aa,
      palegreen: 0x98fb98,
      paleturquoise: 0xafeeee,
      palevioletred: 0xdb7093,
      papayawhip: 0xffefd5,
      peachpuff: 0xffdab9,
      peru: 0xcd853f,
      pink: 0xffc0cb,
      plum: 0xdda0dd,
      powderblue: 0xb0e0e6,
      purple: 0x800080,
      rebeccapurple: 0x663399,
      red: 0xff0000,
      rosybrown: 0xbc8f8f,
      royalblue: 0x4169e1,
      saddlebrown: 0x8b4513,
      salmon: 0xfa8072,
      sandybrown: 0xf4a460,
      seagreen: 0x2e8b57,
      seashell: 0xfff5ee,
      sienna: 0xa0522d,
      silver: 0xc0c0c0,
      skyblue: 0x87ceeb,
      slateblue: 0x6a5acd,
      slategray: 0x708090,
      slategrey: 0x708090,
      snow: 0xfffafa,
      springgreen: 0x00ff7f,
      steelblue: 0x4682b4,
      tan: 0xd2b48c,
      teal: 0x008080,
      thistle: 0xd8bfd8,
      tomato: 0xff6347,
      turquoise: 0x40e0d0,
      violet: 0xee82ee,
      wheat: 0xf5deb3,
      white: 0xffffff,
      whitesmoke: 0xf5f5f5,
      yellow: 0xffff00,
      yellowgreen: 0x9acd32
    };

    define(Color$1, color, {
      copy(channels) {
        return Object.assign(new this.constructor, this, channels);
      },
      displayable() {
        return this.rgb().displayable();
      },
      hex: color_formatHex, // Deprecated! Use color.formatHex.
      formatHex: color_formatHex,
      formatHex8: color_formatHex8,
      formatHsl: color_formatHsl,
      formatRgb: color_formatRgb,
      toString: color_formatRgb
    });

    function color_formatHex() {
      return this.rgb().formatHex();
    }

    function color_formatHex8() {
      return this.rgb().formatHex8();
    }

    function color_formatHsl() {
      return hslConvert(this).formatHsl();
    }

    function color_formatRgb() {
      return this.rgb().formatRgb();
    }

    function color(format) {
      var m, l;
      format = (format + "").trim().toLowerCase();
      return (m = reHex.exec(format)) ? (l = m[1].length, m = parseInt(m[1], 16), l === 6 ? rgbn(m) // #ff0000
          : l === 3 ? new Rgb((m >> 8 & 0xf) | (m >> 4 & 0xf0), (m >> 4 & 0xf) | (m & 0xf0), ((m & 0xf) << 4) | (m & 0xf), 1) // #f00
          : l === 8 ? rgba(m >> 24 & 0xff, m >> 16 & 0xff, m >> 8 & 0xff, (m & 0xff) / 0xff) // #ff000000
          : l === 4 ? rgba((m >> 12 & 0xf) | (m >> 8 & 0xf0), (m >> 8 & 0xf) | (m >> 4 & 0xf0), (m >> 4 & 0xf) | (m & 0xf0), (((m & 0xf) << 4) | (m & 0xf)) / 0xff) // #f000
          : null) // invalid hex
          : (m = reRgbInteger.exec(format)) ? new Rgb(m[1], m[2], m[3], 1) // rgb(255, 0, 0)
          : (m = reRgbPercent.exec(format)) ? new Rgb(m[1] * 255 / 100, m[2] * 255 / 100, m[3] * 255 / 100, 1) // rgb(100%, 0%, 0%)
          : (m = reRgbaInteger.exec(format)) ? rgba(m[1], m[2], m[3], m[4]) // rgba(255, 0, 0, 1)
          : (m = reRgbaPercent.exec(format)) ? rgba(m[1] * 255 / 100, m[2] * 255 / 100, m[3] * 255 / 100, m[4]) // rgb(100%, 0%, 0%, 1)
          : (m = reHslPercent.exec(format)) ? hsla(m[1], m[2] / 100, m[3] / 100, 1) // hsl(120, 50%, 50%)
          : (m = reHslaPercent.exec(format)) ? hsla(m[1], m[2] / 100, m[3] / 100, m[4]) // hsla(120, 50%, 50%, 1)
          : named.hasOwnProperty(format) ? rgbn(named[format]) // eslint-disable-line no-prototype-builtins
          : format === "transparent" ? new Rgb(NaN, NaN, NaN, 0)
          : null;
    }

    function rgbn(n) {
      return new Rgb(n >> 16 & 0xff, n >> 8 & 0xff, n & 0xff, 1);
    }

    function rgba(r, g, b, a) {
      if (a <= 0) r = g = b = NaN;
      return new Rgb(r, g, b, a);
    }

    function rgbConvert(o) {
      if (!(o instanceof Color$1)) o = color(o);
      if (!o) return new Rgb;
      o = o.rgb();
      return new Rgb(o.r, o.g, o.b, o.opacity);
    }

    function rgb(r, g, b, opacity) {
      return arguments.length === 1 ? rgbConvert(r) : new Rgb(r, g, b, opacity == null ? 1 : opacity);
    }

    function Rgb(r, g, b, opacity) {
      this.r = +r;
      this.g = +g;
      this.b = +b;
      this.opacity = +opacity;
    }

    define(Rgb, rgb, extend(Color$1, {
      brighter(k) {
        k = k == null ? brighter : Math.pow(brighter, k);
        return new Rgb(this.r * k, this.g * k, this.b * k, this.opacity);
      },
      darker(k) {
        k = k == null ? darker : Math.pow(darker, k);
        return new Rgb(this.r * k, this.g * k, this.b * k, this.opacity);
      },
      rgb() {
        return this;
      },
      clamp() {
        return new Rgb(clampi(this.r), clampi(this.g), clampi(this.b), clampa(this.opacity));
      },
      displayable() {
        return (-0.5 <= this.r && this.r < 255.5)
            && (-0.5 <= this.g && this.g < 255.5)
            && (-0.5 <= this.b && this.b < 255.5)
            && (0 <= this.opacity && this.opacity <= 1);
      },
      hex: rgb_formatHex, // Deprecated! Use color.formatHex.
      formatHex: rgb_formatHex,
      formatHex8: rgb_formatHex8,
      formatRgb: rgb_formatRgb,
      toString: rgb_formatRgb
    }));

    function rgb_formatHex() {
      return `#${hex(this.r)}${hex(this.g)}${hex(this.b)}`;
    }

    function rgb_formatHex8() {
      return `#${hex(this.r)}${hex(this.g)}${hex(this.b)}${hex((isNaN(this.opacity) ? 1 : this.opacity) * 255)}`;
    }

    function rgb_formatRgb() {
      const a = clampa(this.opacity);
      return `${a === 1 ? "rgb(" : "rgba("}${clampi(this.r)}, ${clampi(this.g)}, ${clampi(this.b)}${a === 1 ? ")" : `, ${a})`}`;
    }

    function clampa(opacity) {
      return isNaN(opacity) ? 1 : Math.max(0, Math.min(1, opacity));
    }

    function clampi(value) {
      return Math.max(0, Math.min(255, Math.round(value) || 0));
    }

    function hex(value) {
      value = clampi(value);
      return (value < 16 ? "0" : "") + value.toString(16);
    }

    function hsla(h, s, l, a) {
      if (a <= 0) h = s = l = NaN;
      else if (l <= 0 || l >= 1) h = s = NaN;
      else if (s <= 0) h = NaN;
      return new Hsl(h, s, l, a);
    }

    function hslConvert(o) {
      if (o instanceof Hsl) return new Hsl(o.h, o.s, o.l, o.opacity);
      if (!(o instanceof Color$1)) o = color(o);
      if (!o) return new Hsl;
      if (o instanceof Hsl) return o;
      o = o.rgb();
      var r = o.r / 255,
          g = o.g / 255,
          b = o.b / 255,
          min = Math.min(r, g, b),
          max = Math.max(r, g, b),
          h = NaN,
          s = max - min,
          l = (max + min) / 2;
      if (s) {
        if (r === max) h = (g - b) / s + (g < b) * 6;
        else if (g === max) h = (b - r) / s + 2;
        else h = (r - g) / s + 4;
        s /= l < 0.5 ? max + min : 2 - max - min;
        h *= 60;
      } else {
        s = l > 0 && l < 1 ? 0 : h;
      }
      return new Hsl(h, s, l, o.opacity);
    }

    function hsl(h, s, l, opacity) {
      return arguments.length === 1 ? hslConvert(h) : new Hsl(h, s, l, opacity == null ? 1 : opacity);
    }

    function Hsl(h, s, l, opacity) {
      this.h = +h;
      this.s = +s;
      this.l = +l;
      this.opacity = +opacity;
    }

    define(Hsl, hsl, extend(Color$1, {
      brighter(k) {
        k = k == null ? brighter : Math.pow(brighter, k);
        return new Hsl(this.h, this.s, this.l * k, this.opacity);
      },
      darker(k) {
        k = k == null ? darker : Math.pow(darker, k);
        return new Hsl(this.h, this.s, this.l * k, this.opacity);
      },
      rgb() {
        var h = this.h % 360 + (this.h < 0) * 360,
            s = isNaN(h) || isNaN(this.s) ? 0 : this.s,
            l = this.l,
            m2 = l + (l < 0.5 ? l : 1 - l) * s,
            m1 = 2 * l - m2;
        return new Rgb(
          hsl2rgb(h >= 240 ? h - 240 : h + 120, m1, m2),
          hsl2rgb(h, m1, m2),
          hsl2rgb(h < 120 ? h + 240 : h - 120, m1, m2),
          this.opacity
        );
      },
      clamp() {
        return new Hsl(clamph(this.h), clampt(this.s), clampt(this.l), clampa(this.opacity));
      },
      displayable() {
        return (0 <= this.s && this.s <= 1 || isNaN(this.s))
            && (0 <= this.l && this.l <= 1)
            && (0 <= this.opacity && this.opacity <= 1);
      },
      formatHsl() {
        const a = clampa(this.opacity);
        return `${a === 1 ? "hsl(" : "hsla("}${clamph(this.h)}, ${clampt(this.s) * 100}%, ${clampt(this.l) * 100}%${a === 1 ? ")" : `, ${a})`}`;
      }
    }));

    function clamph(value) {
      value = (value || 0) % 360;
      return value < 0 ? value + 360 : value;
    }

    function clampt(value) {
      return Math.max(0, Math.min(1, value || 0));
    }

    /* From FvD 13.37, CSS Color Module Level 3 */
    function hsl2rgb(h, m1, m2) {
      return (h < 60 ? m1 + (m2 - m1) * h / 60
          : h < 180 ? m2
          : h < 240 ? m1 + (m2 - m1) * (240 - h) / 60
          : m1) * 255;
    }

    const TRANSPARENT = [0, 0, 0, 0];
    /** Drawn for a gradient on an item without bounds, which has nothing to map the ramp onto. */
    const GRADIENT_FALLBACK = [0.5, 1.0, 1.0, 1.0];
    function isGradient(value) {
        return typeof value === 'object' && value !== null && ('gradient' in value || 'id' in value);
    }
    /** Parses a CSS color string to premultiplication-ready normalized RGBA. */
    function parse(value) {
        const c = color(value);
        if (c === null) {
            warnOnce('color', `[vega-webgpu] Could not parse color '${value}'.`);
            return TRANSPARENT;
        }
        const rgb = c.rgb();
        // d3 gives a fully transparent colour NaN channels, whatever was written, and
        // those reach a clear value and a vertex buffer exactly as they are: a spec
        // with a transparent background failed the frame outright.
        return [channel(rgb.r), channel(rgb.g), channel(rgb.b), Number.isFinite(rgb.opacity) ? rgb.opacity : 0];
    }
    function channel(value) {
        return Number.isFinite(value) ? value / 255 : 0;
    }
    let probe;
    const cssCache = new Map();
    /**
     * A colour as canvas parses it, or null when it does not. d3-color sets the
     * channels of a colour at zero alpha to NaN, and a gradient interpolates
     * through them, so a stop like rgba(255,0,0,0) fades from red on canvas.
     */
    function cssColor(value) {
        let parsed = cssCache.get(value);
        if (parsed === undefined) {
            parsed = parseCss(value);
            cssCache.set(value, parsed);
        }
        return parsed;
    }
    function parseCss(value) {
        probe ??= typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
        if (probe) {
            // an invalid colour leaves fillStyle as it was, so two starting points differ
            probe.fillStyle = '#000000';
            probe.fillStyle = value;
            const read = String(probe.fillStyle);
            probe.fillStyle = '#ffffff';
            probe.fillStyle = value;
            if (String(probe.fillStyle) !== read) {
                return null;
            }
            const css = readCss(read);
            if (css) {
                return css;
            }
        }
        const c = color(value)?.rgb();
        return c ? [c.r, c.g, c.b, c.opacity] : null;
    }
    /** The two forms canvas serializes an sRGB colour in. */
    function readCss(s) {
        if (/^#[0-9a-f]{6}$/i.test(s)) {
            return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), 1];
        }
        const rgba = /^rgba?\(([^)]*)\)$/.exec(s);
        if (!rgba) {
            return null;
        }
        const [r, g, b, a = 1] = rgba[1].split(',').map(Number);
        return [r, g, b, a].every(Number.isFinite) ? [r, g, b, a] : null;
    }
    class Color {
        static cache = {};
        /** The colour's unscaled rgba, cached per string. */
        static resolve(value) {
            if (value == null || value === 'transparent') {
                return TRANSPARENT;
            }
            if (isGradient(value)) {
                warnOnce('gradient', '[vega-webgpu] A gradient on an item without bounds is drawn as a flat colour.');
                return GRADIENT_FALLBACK;
            }
            let rgba = Color.cache[value];
            if (rgba === undefined) {
                rgba = parse(value);
                Color.cache[value] = rgba;
            }
            return rgba;
        }
        /**
         * A scenegraph colour as normalized rgba, with the item's opacity and its
         * fill or stroke opacity applied. Unset becomes transparent.
         */
        static from(value, opacity = 1.0, fsOpacity = 1.0) {
            const [r, g, b, a] = Color.resolve(value);
            return [r, g, b, a * opacity * fsOpacity];
        }
        /**
         * Writes the colour straight into `out` at `index`, which is what a per item
         * attribute loop wants: `from` allocates a fresh array on every call, and a
         * mark resolves a fill and a stroke for each of its items on every frame.
         */
        static write(out, index, value, opacity = 1.0, fsOpacity = 1.0) {
            const rgba = Color.resolve(value);
            out[index] = rgba[0];
            out[index + 1] = rgba[1];
            out[index + 2] = rgba[2];
            out[index + 3] = rgba[3] * opacity * fsOpacity;
        }
    }

    /** Texels in a baked gradient stop ramp. */
    const RAMP_SIZE = 256;
    function getGradientResources(device, ctx) {
        return getMarkResources(ctx, '__gradient', device, undefined, () => ({
            device,
            ramps: new Map(),
        }));
    }
    function rampKey(gradient) {
        return gradient.id ?? `${gradient.gradient}:${JSON.stringify(gradient.stops ?? [])}`;
    }
    /** Bakes the gradient's color stops into a RAMP_SIZE x 1 texture. */
    function getStopRamp(res, gradient) {
        const key = rampKey(gradient);
        const cached = res.ramps.get(key);
        if (cached) {
            return cached;
        }
        const stops = (gradient.stops ?? [])
            .map(s => {
            const c = cssColor(s.color);
            return {
                offset: Math.min(Math.max(s.offset, 0), 1),
                r: c ? c[0] : 0,
                g: c ? c[1] : 0,
                b: c ? c[2] : 0,
                a: c ? c[3] : 1,
            };
        })
            .sort((a, b) => a.offset - b.offset);
        if (stops.length === 0) {
            stops.push({ offset: 0, r: 0, g: 0, b: 0, a: 1 });
        }
        const data = new Uint8Array(RAMP_SIZE * 4);
        for (let i = 0; i < RAMP_SIZE; i++) {
            const t = (i + 0.5) / RAMP_SIZE;
            let lo = stops[0];
            let hi = stops[stops.length - 1];
            for (let s = 0; s < stops.length - 1; s++) {
                if (t >= stops[s].offset && t <= stops[s + 1].offset) {
                    lo = stops[s];
                    hi = stops[s + 1];
                    break;
                }
            }
            const span = hi.offset - lo.offset;
            const f = span > 0 ? Math.min(Math.max((t - lo.offset) / span, 0), 1) : 0;
            data[i * 4] = Math.round(lo.r + (hi.r - lo.r) * f);
            data[i * 4 + 1] = Math.round(lo.g + (hi.g - lo.g) * f);
            data[i * 4 + 2] = Math.round(lo.b + (hi.b - lo.b) * f);
            data[i * 4 + 3] = Math.round((lo.a + (hi.a - lo.a) * f) * 255);
        }
        const texture = res.device.createTexture({
            label: 'Gradient Stop Ramp',
            size: [RAMP_SIZE, 1, 1],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        res.device.queue.writeTexture({ texture }, data, { bytesPerRow: RAMP_SIZE * 4 }, [RAMP_SIZE, 1, 1]);
        res.ramps.set(key, texture);
        return texture;
    }
    /**
     * Gradient parameters as consumed by the gradient shaders:
     * coords = [x1, y1, x2, y2], bounds = [x, y, w, h] mapping positions into
     * the normalized gradient space, misc = [kind, r1, r2, 0].
     * A radial runs between the circles (x1, y1, r1) and (x2, y2, r2), as canvas does.
     */
    function gradientParams(gradient, bounds) {
        const radial = gradient.gradient === 'radial';
        const x1 = gradient.x1 ?? (radial ? 0.5 : 0);
        const y1 = gradient.y1 ?? (radial ? 0.5 : 0);
        const x2 = gradient.x2 ?? (radial ? 0.5 : 1);
        const y2 = gradient.y2 ?? (radial ? 0.5 : 0);
        const r1 = gradient.r1 ?? 0;
        const r2 = gradient.r2 ?? 0.5;
        return Float32Array.from([x1, y1, x2, y2, ...bounds, radial ? 2 : 1, r1, r2, 0]);
    }
    /** Creates the per-draw gradient bind group (params + ramp + sampler). */
    function createGradientBindGroup(res, pipeline, gradient, bounds) {
        // one per gradient draw, so it goes in the frame pool like every other
        const paramsBuffer = uploadBuffer(res.device, 'Gradient Params', gradientParams(gradient, bounds), GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
        return res.device.createBindGroup({
            label: 'Gradient Bind Group',
            layout: bindGroupLayout(pipeline, 1),
            entries: [
                { binding: 0, resource: linearSampler(res.device) },
                { binding: 1, resource: viewOf(getStopRamp(res, gradient)) },
                { binding: 2, resource: { buffer: paramsBuffer } },
            ],
        });
    }

    /**
     * Returns the GPU resources for a mark type, creating them on first use
     * or after a device change. Resources live on the canvas context, so each
     * renderer instance keeps its own set.
     */
    function getMarkResources(ctx, markType, device, vb, create) {
        const cached = ctx._markCache[markType];
        const res = cached && cached.device === device ? cached : (ctx._markCache[markType] = create());
        // Resources outlive the frame, so a cached BufferManager still holds the
        // previous frame's resolution and group offset. Refreshing here means a mark
        // cannot forget to, which would draw the whole mark at a stale offset.
        if (vb) {
            const buffers = res.bufferManager;
            buffers?.setResolution(ctx._uniforms.resolution);
            buffers?.setOffset(vb.x1, vb.y1);
            buffers?.setDpi(ctx._uniforms.dpi);
            buffers?.setClipRound(ctx._clipRound);
            buffers?.setClipMask(ctx._clipMask !== undefined);
        }
        return res;
    }
    /**
     * Floats per triangulated vertex: position and colour. Every buffer
     * `vertexData` writes and every draw that consumes one is this wide, which is
     * also the layout `fillResources` builds its pipelines with.
     */
    const GEOMETRY_STRIDE = 6;
    /** Triangulated geometry in one colour, as [x, y, r, g, b, a] vertices. */
    function vertexData(triangles, count, color) {
        const data = new Float32Array(count * GEOMETRY_STRIDE);
        for (let i = 0; i < count; i++) {
            const o = i * GEOMETRY_STRIDE;
            data[o] = triangles[i * 2];
            data[o + 1] = triangles[i * 2 + 1];
            data[o + 2] = color[0];
            data[o + 3] = color[1];
            data[o + 4] = color[2];
            data[o + 5] = color[3];
        }
        return data;
    }
    const heldFills = new WeakMap();
    /**
     * vertexData for triangles a cache already holds, kept beside them while the
     * colour stays the same. An area or a trail that has not moved is the same
     * cached geometry frame after frame.
     */
    function heldVertexData(triangles, count, color) {
        const held = heldFills.get(triangles);
        if (held && sameColor(held.color, color)) {
            return held.data;
        }
        const data = vertexData(triangles, count, color);
        heldFills.set(triangles, { color, data });
        return data;
    }
    /**
     * A box in the current group's coordinates, as a scissor rect in device
     * pixels. The group translation is already in `_tx`.
     */
    function deviceClip(ctx, x, y, w, h) {
        const dpi = ctx._uniforms.dpi;
        return [(ctx._origin[0] + ctx._tx + x) * dpi, (ctx._origin[1] + ctx._ty + y) * dpi, w * dpi, h * dpi];
    }
    /**
     * The clip path's coverage for the mark being drawn, or the 1x1 placeholder
     * where there is no path clip.
     *
     * Every mark pipeline reads this binding, because every fragment entry calls
     * `clipCoverage`, so one has to be bound whether or not a clip path is in
     * force. The uniform flag beside it is what decides whether it is read.
     */
    function clipMaskView(ctx, device) {
        return ctx._clipMask ?? ctx._renderer.clipMaskPlaceholderView(device);
    }
    /** A mark's group 0 bind group, with the clip mask in force. */
    function uniformBindGroup(ctx, device, label, pipeline, uniforms) {
        return createUniformBindGroup(label, device, pipeline, uniforms, clipMaskView(ctx, device));
    }
    /**
     * Two scissor rects narrowed to what both cover, which is what canvas's
     * `context.clip()` does to whatever is already clipped. An empty result is
     * left with a zero extent and the render queue drops the draw.
     */
    function intersectClip(outer, inner) {
        if (!outer) {
            return inner;
        }
        const x = Math.max(outer[0], inner[0]);
        const y = Math.max(outer[1], inner[1]);
        const x2 = Math.min(outer[0] + outer[2], inner[0] + inner[2]);
        const y2 = Math.min(outer[1] + outer[3], inner[1] + inner[3]);
        return [x, y, Math.max(x2 - x, 0), Math.max(y2 - y, 0)];
    }
    /** Reused by the clip-path measurement below, which runs per mark per frame. */
    const clipPathBounds = new vegaScenegraph.Bounds();
    /**
     * Narrows the scissor to a clip path's box. The path itself is cut by its
     * coverage mask, which the renderer draws beside this.
     */
    function pushPathClip(ctx, clip) {
        const b = clipPathBounds.clear();
        clip(vegaScenegraph.boundContext(b));
        if (!b.empty()) {
            ctx._clip = intersectClip(ctx._clip, deviceClip(ctx, b.x1, b.y1, b.width(), b.height()));
        }
    }
    /**
     * Narrows the clip to a group's rectangle, which canvas clips a clipping group
     * to, and a mark with `clip: true` inside one. canvas narrows whatever is
     * already clipped rather than replacing it, so a clip inside a clip is cut by
     * both. The rectangle is rounded where the group is, which a scissor cannot
     * express, so the corners are cut in the fragment stage. A group with no radius
     * of its own leaves an enclosing rounded clip cutting.
     */
    function pushGroupClip(ctx, group) {
        const box = deviceClip(ctx, 0, 0, group.width || 0, group.height || 0);
        ctx._clip = intersectClip(ctx._clip, box);
        const radii = clipRadii(group, ctx._uniforms.dpi);
        if (radii) {
            ctx._clipRound = { box, radii };
        }
    }
    /**
     * A clipping group's corner radii in device pixels, clockwise from top left.
     *
     * Clamped to half the shorter side, as vega's own rectangle generator does.
     * Past that the four corner arcs overlap, and the shader would cut with the
     * first one that matches rather than the nearer of the two.
     */
    function clipRadii(group, dpi) {
        const base = group.cornerRadius ?? 0;
        const limit = (Math.min(group.width || 0, group.height || 0) / 2) * dpi;
        const at = (corner) => Math.max(0, Math.min((corner ?? base) * dpi, limit));
        const radii = [
            at(group.cornerRadiusTopLeft),
            at(group.cornerRadiusTopRight),
            at(group.cornerRadiusBottomRight),
            at(group.cornerRadiusBottomLeft),
        ];
        return radii.some(r => r > 0) ? radii : undefined;
    }
    /**
     * An item's bounding box as [x, y, w, h] for a gradient to map its ramp over,
     * which is what vega's canvas renderer spans one across.
     *
     * Both the bounds and the geometry are in the enclosing group's coordinates,
     * and the group translation reaches the shader through the offset uniform, so
     * adding it here once more moved a ramp by the group offset.
     */
    function gradientBounds(bounds) {
        return [bounds.x1, bounds.y1, Math.max(bounds.width(), 1e-6), Math.max(bounds.height(), 1e-6)];
    }
    /**
     * The box a rect or a group background spans its ramp over.
     *
     * vega's boundStroke grows an item's bounds by a whole stroke width on each
     * side, so a stroked rect fills its gradient over rather more than its own
     * box. A scenegraph that reached the renderer unbounded keeps the box.
     */
    function boxGradientBounds(item) {
        if (item.bounds) {
            return gradientBounds(item.bounds);
        }
        const pad = item.stroke ? (item.strokeWidth ?? 1) : 0;
        const [x, y, w, h] = rectBox(item);
        return [x - pad, y - pad, Math.max(w + 2 * pad, 1e-6), Math.max(h + 2 * pad, 1e-6)];
    }
    /**
     * A rect's box with a negative extent flipped onto the other side of x or y,
     * which is how canvas's fillRect and strokeRect draw one.
     */
    function rectBox(item) {
        let x = item.x || 0;
        let y = item.y || 0;
        let w = item.width || 0;
        let h = item.height || 0;
        if (w < 0) {
            x += w;
            w = -w;
        }
        if (h < 0) {
            y += h;
            h = -h;
        }
        return [x, y, w, h];
    }
    /** Fill color for vertex data: white carrier with opacity when a gradient is used. */
    function whiteCarrier(opacity = 1, fillOpacity = 1) {
        return [1, 1, 1, opacity * fillOpacity];
    }
    /**
     * The ramp a paint draws from, or null for a flat colour. A gradient spans the
     * item's bounds, and with none it has nothing to span and draws flat.
     */
    function rampOf(value, bounds) {
        return isGradient(value) && bounds ? { gradient: value, bounds: gradientBounds(bounds) } : null;
    }
    /** The same for a rect or a group, which span their own box when they have no bounds. */
    function boxRampOf(value, item) {
        return isGradient(value) ? { gradient: value, bounds: boxGradientBounds(item) } : null;
    }
    /** The colour a paint's vertices carry: white at its opacity under a ramp, its own colour otherwise. */
    function paintColour(value, opacity, paintOpacity, ramp) {
        return ramp ? whiteCarrier(opacity, paintOpacity) : Color.from(value, opacity, paintOpacity);
    }
    /** A fill or a stroke as it draws, for an item that spans its bounds. */
    function paintOf(value, opacity, paintOpacity, bounds) {
        const ramp = rampOf(value, bounds);
        return { colour: paintColour(value, opacity, paintOpacity, ramp), ramp };
    }
    function targetOf(ctx, device, name, pipelines, bufferManager, uniformBuffer) {
        const { pipelineFor, gradientPipelineFor } = pipelines;
        return { ctx, device, name, pipelineFor, gradientPipelineFor, bufferManager, uniformBuffer };
    }
    /**
     * One scratch array every instance builder writes into, so a mark does not
     * mint a new one each frame. createInstanceBuffer copies through writeBuffer
     * before it returns, so the next builder is free to overwrite it. At 300k
     * symbols this is 13.7 MB a frame that no longer has to be allocated and
     * collected. A batched draw holds its chunk instead, so it keeps its own.
     */
    let scratch = new Float32Array(0);
    function instanceScratch(length) {
        if (scratch.length < length) {
            scratch = new Float32Array(length);
        }
        return scratch.subarray(0, length);
    }
    /**
     * A mark's items in the order canvas paints them.
     *
     * vega draws the items carrying no zindex in list order and the raised ones
     * after, and its canvas renderer gets that by routing every mark through
     * sceneVisit. This one did it for group alone, so a raised item was picked as
     * if it were on top and drawn as if it were not.
     *
     * The list is returned untouched unless vega has actually z-ordered the mark,
     * which is the usual case and costs nothing. area, line and trail draw all
     * their items as one shape, so they keep the list whatever it says.
     */
    function markItems(scene) {
        const items = (scene.items ?? []);
        if (!scene.zdirty && scene.zitems === undefined) {
            return items;
        }
        const out = [];
        vegaScenegraph.sceneVisit(scene, (item) => out.push(item));
        return out;
    }
    /** Queues one buffer of triangles, coloured by its vertices or from a ramp. */
    function enqueueFill(target, data, ramp, blend = 'normal') {
        enqueueDraw(target, ramp, blend, [data.length / GEOMETRY_STRIDE], [target.bufferManager.createGeometryBuffer(data)]);
    }
    /** Queues a draw through the target's pipelines, sampling the ramp when there is one. */
    function enqueueDraw(target, ramp, blend, drawCounts, vertexBuffers) {
        const { ctx, device } = target;
        const pipeline = ramp ? target.gradientPipelineFor(blend) : target.pipelineFor(blend);
        const bindGroups = [uniformBindGroup(ctx, device, target.name, pipeline, target.uniformBuffer)];
        if (ramp) {
            bindGroups.push(createGradientBindGroup(getGradientResources(device, ctx), pipeline, ramp.gradient, ramp.bounds));
        }
        ctx._renderQueue.enqueue({ pipeline, drawCounts, vertexBuffers, bindGroups, clip: ctx._clip });
    }
    /**
     * Builds a mark pipeline. The colour format and sample count must match the
     * frame's attachments, and getting either wrong silently breaks MSAA, so they
     * are filled in here rather than repeated at every call site.
     */
    function markPipeline(ctx, device, label, shaderKey, vertexManager, fragmentEntryPoint, blend = 'normal') {
        // The backdrop decides how a blend is drawn and it can change between frames,
        // so it belongs in the key: a pipeline built for one is wrong for the other.
        const opaque = ctx._opaqueBackdrop;
        const key = `${shaderKey}|${fragmentEntryPoint ?? ''}|${ctx._sampleCount}|${blend}|${opaque}|${vertexManager.layoutKey}`;
        const cached = ctx._pipelineCache[key];
        if (cached) {
            return cached;
        }
        const built = buildBlend(blend, opaque);
        const pipeline = createRenderPipeline(label, device, shaderModule(ctx, device, shaderKey, built.blend), preferredColorFormat(), ctx._sampleCount, vertexManager.getBuffers(), blendState(built.blend), fragmentEntryPoint);
        built.record(pipeline);
        ctx._pipelineCache[key] = pipeline;
        return pipeline;
    }
    /** The dash pattern of an item, or null when its outline draws solid. */
    function dashPatternOf(item) {
        const dash = item.strokeDash;
        return Array.isArray(dash) && dash.some(d => d > 0) ? dash : null;
    }
    function fillResources(ctx, device, vb, name, outlineName = `${name}Dash`) {
        const bufferManager = new BufferManager(device, name);
        const vertexManager = new VertexBufferManager(['float32x2', 'float32x4']); // position, colour
        return {
            device,
            bufferManager,
            vertexManager,
            pipelineFor: blendPipelines(ctx, device, name, 'SolidFill', vertexManager),
            gradientPipelineFor: blendPipelines(ctx, device, `${name}Gradient`, 'GradientFill', vertexManager),
            outline: outlinePipelines(ctx, device, outlineName),
        };
    }
    /** What a mark needs to draw an outline, from a ramp when one is set. */
    function outlinePipelines(ctx, device, name) {
        const vertexManager = new VertexBufferManager([], SEGMENT_LAYOUT);
        return {
            name,
            vertexManager,
            pipelineFor: blendPipelines(ctx, device, name, 'SLine', vertexManager),
            gradientPipelineFor: blendPipelines(ctx, device, `${name}Gradient`, 'SLine', vertexManager, 'main_fragment_gradient'),
        };
    }
    /**
     * One pipeline per blend mode, for one shader and layout.
     *
     * A blend is baked into the pipeline state, so a mark needs one of these for
     * every mode its items ask for. `markPipeline` keys its cache on a string built
     * per call, and only the blend and the backdrop vary here, so the pipelines are
     * held by blend and dropped when the backdrop flips. A sample count change
     * rebuilds the mark resources this lives in.
     */
    function blendPipelines(ctx, device, name, shader, vertexManager, fragmentEntryPoint) {
        const held = new Map();
        let opaque = ctx._opaqueBackdrop;
        return blend => {
            if (opaque !== ctx._opaqueBackdrop) {
                held.clear();
                opaque = ctx._opaqueBackdrop;
            }
            let pipeline = held.get(blend);
            if (!pipeline) {
                pipeline = markPipeline(ctx, device, name, shader, vertexManager, fragmentEntryPoint, blend);
                held.set(blend, pipeline);
            }
            return pipeline;
        };
    }
    /**
     * Draws an outline as segments, taking its colour from a ramp when the stroke
     * is a gradient.
     *
     * A gradient stroke used to keep the extruded ribbon, since only that could
     * sample a ramp, and a ribbon carries no dash: a stroke that was both came out
     * solid with the dash silently dropped. The segment shader has a gradient entry
     * now, so both reach the same draw.
     */
    function enqueueOutline(target, data, ramp, blend) {
        enqueueDraw(target, ramp, blend, [6, data.length / SEGMENT_STRIDE], [target.bufferManager.createInstanceBuffer(data)]);
    }
    function getClipMaskResources(device, ctx, vb) {
        return getMarkResources(ctx, '__clipMask', device, vb, () => {
            const vertexManager = new VertexBufferManager(['float32x2', 'float32x4']);
            return {
                device,
                bufferManager: new BufferManager(device, 'ClipMask'),
                pipeline: maskPipeline(ctx, device, 'Clip Mask', 'SolidFill', ctx._sampleCount, vertexManager),
            };
        });
    }
    /**
     * Draws a clip path's coverage into a target of its own and returns it, for
     * the marks inside that clip to be cut by.
     *
     * vega parses `clip: {path}` and `clip: {sphere}` into a generator that draws
     * the path when it is given a context and returns the path when it is not,
     * which is the string this triangulates. Enqueued as a mask run, so the queue
     * lifts it into a pass ahead of everything that reads it.
     */
    function drawClipMask(device, ctx, clip, vb) {
        const path = clip();
        if (typeof path !== 'string' || path.length === 0) {
            return undefined;
        }
        const res = getClipMaskResources(device, ctx, vb);
        // Every mark that reads this mask cuts its own corners against the rounded
        // box in force, so folding that in here as well squares its coverage along
        // the arc. The clip mask already in force does belong in it, which is what
        // makes a clip inside a clip the intersection of the two.
        res.bufferManager.setClipRound(undefined);
        const traced = geometryForPath(ctx, path);
        let fillData = clipFills.get(traced);
        if (!fillData) {
            const geometry = geometryForItem(ctx, { fill: '#ffffff' }, traced, false, 0, 0);
            fillData = vertexData(geometry.fillTriangles, geometry.fillCount, [1, 1, 1, 1]);
            clipFills.set(traced, fillData);
        }
        if (fillData.length === 0) {
            return undefined;
        }
        // Taken once there is something to draw into it, so a path that triangulates
        // to nothing does not hold a pooled target for the rest of the frame.
        const target = ctx._renderer.acquireClipMask(device, ctx._sampleCount);
        if (!target) {
            return undefined;
        }
        const uniformBuffer = res.bufferManager.createUniformBuffer();
        ctx._renderQueue.enqueue({
            pipeline: res.pipeline,
            drawCounts: [fillData.length / GEOMETRY_STRIDE],
            vertexBuffers: [res.bufferManager.createGeometryBuffer(fillData)],
            bindGroups: [uniformBindGroup(ctx, device, 'ClipMask', res.pipeline, uniformBuffer)],
            pass: 'mask',
            maskView: target.attachment,
            maskResolve: target.resolve,
        });
        return target.read;
    }
    /** A clip path's coverage as vertex data, held beside the path it was traced from. */
    const clipFills = new WeakMap();
    /** Single channel coverage, which is all a mask holds. */
    const MASK_FORMAT = 'r8unorm';
    /** Coverage drawn into a mask keeps the largest of whatever overlaps there. */
    const MAX_COVERAGE = {
        color: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
        alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
    };
    /** A pipeline that draws coverage into a mask, through the shader's mask entry. */
    function maskPipeline(ctx, device, label, shaderKey, sampleCount, vertexManager) {
        return createRenderPipeline(label, device, shaderModule(ctx, device, shaderKey, 'normal'), MASK_FORMAT, sampleCount, vertexManager.getBuffers(), MAX_COVERAGE, 'main_fragment_mask');
    }
    function getMaskResources(device, ctx) {
        return getMarkResources(ctx, '__mask', device, undefined, () => {
            const vertexManager = new VertexBufferManager([], SEGMENT_LAYOUT);
            const strokePipeline = maskPipeline(ctx, device, 'Coverage Mask', 'SLine', 1, vertexManager);
            // a mark pipeline in all but its shader, so a mode the blend state cannot
            // express paints the mask into a layer and is folded in from there
            const compositeFor = blendPipelines(ctx, device, 'Mask Composite', 'MaskComposite', new VertexBufferManager());
            return { device, strokePipeline, compositeFor };
        });
    }
    function getBlendResources(device, ctx) {
        return getMarkResources(ctx, '__blend', device, undefined, () => {
            const composites = new Map();
            const compositeFor = (blend) => {
                const held = composites.get(blend);
                if (held) {
                    return held;
                }
                const pipeline = createRenderPipeline(`Blend Composite ${blend}`, device, shaderModule(ctx, device, 'BlendComposite', blend), preferredColorFormat(), ctx._sampleCount, [], REPLACE);
                composites.set(blend, pipeline);
                return pipeline;
            };
            return { device, compositeFor };
        });
    }
    /**
     * The draw that folds a layer run back into the frame with its blend evaluated.
     *
     * Everything it needs is the two textures, so the queue can build it for any
     * mark without knowing anything about that mark.
     */
    function blendCompositeElement(ctx, device, blend, clip) {
        const pipeline = getBlendResources(device, ctx).compositeFor(blend);
        const targets = ctx._renderer.blendTargets(device, ctx._sampleCount);
        return {
            pipeline,
            drawCounts: [3],
            vertexBuffers: [],
            bindGroups: [
                device.createBindGroup({
                    label: 'Blend Composite Bind Group',
                    layout: bindGroupLayout(pipeline, 0),
                    entries: [
                        { binding: 0, resource: viewOf(targets.resolve) },
                        { binding: 1, resource: viewOf(targets.backdrop) },
                    ],
                }),
            ],
            clip,
        };
    }
    /** Box the instances cover, in their own space, grown by `reach`. */
    function segmentExtent(data, reach) {
        let x1 = Infinity;
        let y1 = Infinity;
        let x2 = -Infinity;
        let y2 = -Infinity;
        for (let i = 0; i < data.length; i += SEGMENT_STRIDE) {
            x1 = Math.min(x1, data[i], data[i + 2]);
            y1 = Math.min(y1, data[i + 1], data[i + 3]);
            x2 = Math.max(x2, data[i], data[i + 2]);
            y2 = Math.max(y2, data[i + 1], data[i + 3]);
        }
        if (!Number.isFinite(x1)) {
            return [0, 0, 0, 0];
        }
        return [x1 - reach, y1 - reach, x2 - x1 + reach * 2, y2 - y1 + reach * 2];
    }
    /** How far past an end point a stroke of this item can reach. */
    function strokeReach(item) {
        const half = (item.strokeWidth ?? 1) / 2;
        const { style, miterLimit } = joinStyleOf(item);
        return (style === 'miter' ? half * miterLimit : half) + 2;
    }
    /**
     * Draws an outline into the coverage mask and composites it once.
     *
     * A stroke whose own bands overlap cannot be composited band by band. vega
     * writes one closed contour per trail segment and consecutive contours overlap,
     * so two antialiased fringes land on the same pixel, and compositing both
     * darkens every joint where canvas fills the union once. The mask keeps the
     * largest coverage each pixel receives, which is that union, and the composite
     * that follows paints it in one go.
     *
     * The quad covers the box the instances reach rather than the frame, so the
     * cost follows the mark and not the canvas.
     */
    function enqueueMaskedOutline(target, data, blend, color, reach) {
        const { ctx, device } = target;
        const res = getMaskResources(device, ctx);
        ctx._renderQueue.enqueue({
            pipeline: res.strokePipeline,
            drawCounts: [6, data.length / SEGMENT_STRIDE],
            vertexBuffers: [target.bufferManager.createInstanceBuffer(data)],
            bindGroups: [uniformBindGroup(ctx, device, `${target.name}Mask`, res.strokePipeline, target.uniformBuffer)],
            clip: ctx._clip,
            pass: 'mask',
        });
        const pipeline = res.compositeFor(blend);
        const rect = segmentExtent(data, reach);
        const params = uploadBuffer(device, `${target.name} Mask Params`, new Float32Array([color[0], color[1], color[2], color[3], rect[0], rect[1], rect[2], rect[3]]), GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
        ctx._renderQueue.enqueue({
            pipeline,
            drawCounts: [6],
            vertexBuffers: [],
            bindGroups: [
                uniformBindGroup(ctx, device, `${target.name}Composite`, pipeline, target.uniformBuffer),
                device.createBindGroup({
                    label: `${target.name} Mask Bind Group`,
                    layout: bindGroupLayout(pipeline, 1),
                    entries: [
                        { binding: 0, resource: viewOf(ctx._renderer.maskTexture(device)) },
                        { binding: 1, resource: { buffer: params } },
                    ],
                }),
            ],
            clip: ctx._clip,
        });
    }
    /**
     * The runs an item's stroke draws: the contours the stroke is extruded from,
     * placed, and cut into dashes when the item has a pattern. Contours that need
     * neither come back untouched.
     */
    function strokeRuns(lines, item, place) {
        const placed = place ? placeContours(lines, place) : lines;
        const pattern = dashPatternOf(item);
        // square caps close the gaps they cover, see bridgeGaps
        const bridge = item.strokeCap === 'square' ? (item.strokeWidth ?? 1) : 0;
        const dash = pattern && prepareDash(pattern, item.strokeDashOffset ?? 0, bridge);
        return dash ? placed.flatMap(line => dashPolyline(line, dash)) : placed;
    }
    function placeContours(lines, { dx, dy, angle = 0, scaleX = 1, scaleY = 1 }) {
        if (dx === 0 && dy === 0 && angle === 0 && scaleX === 1 && scaleY === 1) {
            return lines;
        }
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        return lines.map(line => line.map(([px, py]) => {
            const x = px * scaleX;
            const y = py * scaleY;
            return [x * cos - y * sin + dx, x * sin + y * cos + dy];
        }));
    }
    /**
     * Vertex layout of a single line segment instance, shared by every mark that
     * draws through the SLine shader: line segments, dashes, dashed borders,
     * diagonal rules and shape outlines. The two join fields say how each end
     * finishes, as a flat cut, a round cap or the bisector of a corner, and the
     * last pair how far the neighbour at each end runs.
     */
    const SEGMENT_LAYOUT = [
        'float32x2',
        'float32x2',
        'float32x4',
        'float32',
        'float32x4',
        'float32x4',
        'float32x2',
    ];
    /**
     * Floats per segment instance: start, end, colour, width, an end each, and how
     * far the neighbour at each end reaches.
     */
    const SEGMENT_STRIDE = 19;
    /** Offsets of the two end fields within an instance, and of the reach pair. */
    const START_END = 9;
    const END_END = 13;
    const REACH = 17;
    /**
     * Stands in for a neighbour that does not stop where its own far end is, which
     * is any vertex that is itself a join.
     */
    const FAR_REACH = 1e7;
    /** The caps and join of an item. */
    function strokeEnds(item) {
        const cap = capEnd(item.strokeCap);
        return { caps: [cap, cap], join: joinStyleOf(item), square: item.strokeCap === 'square' };
    }
    /** Packs every segment of every polyline, or null when there is nothing to draw. */
    function segmentInstances(runs, color, width, ends) {
        const count = segmentCount(runs);
        if (count === 0) {
            return null;
        }
        const data = new Float32Array(count * SEGMENT_STRIDE);
        writeSegments(data, 0, runs, color, width, ends);
        return data;
    }
    /** Segments a set of polyline runs turns into. */
    function segmentCount(runs) {
        let n = 0;
        for (const run of runs) {
            n += Math.max(0, run.length - 1);
        }
        return n;
    }
    /** The seam of a closed run, held between the two segments that share it. */
    const seam = new Float32Array(4);
    /**
     * Writes runs as segment instances into `data` at `offset`, returning where it
     * stopped. Field by field rather than through a temporary array, since a
     * choropleth's borders run to hundreds of thousands of segments a frame.
     *
     * `caps` applies to a run's two outer ends, and every vertex between them gets
     * a join. A run that comes back to where it started has no outer end at all:
     * its seam is a vertex like any other, which is what draws the corner there.
     *
     * Two runs whose facing round caps reach each other, which is every gap of a
     * dash narrower than the stroke, have both cut back to the midpoint between
     * them. With equal radii each arc is the outer one on its own side, so the two
     * cuts trace the union's outline exactly and neither draws over the other. Left
     * whole they overlap, which an opaque stroke hides and a blend does not.
     *
     * Each join also carries how far its neighbour runs. A segment gives up the far
     * side of the bisector on the understanding that the other one draws it, which
     * needs the other one to reach up to a half width past the vertex. A dash cut
     * landing nearer than that leaves a stub that cannot, and the sliver was then
     * drawn by neither: the stroke came out cut off along the inside of the corner.
     * Past where the neighbour stops, the cut does not apply.
     */
    function writeSegments(data, offset, runs, color, width, { caps, join, square }) {
        const [r, g, b, a] = color;
        const half = width / 2;
        const { style, miterLimit } = join;
        const meets = capMeetings(runs, width, caps[0]);
        let i = offset;
        for (let ri = 0; ri < runs.length; ri++) {
            const run = runs[ri];
            const n = run.length;
            if (n < 2) {
                continue;
            }
            const startCap = meets[ri * 2] ?? caps[0];
            const endCap = meets[ri * 2 + 1] ?? caps[1];
            const loop = isLoop(run);
            // A square cap is a butt end on a run half a stroke longer at each outer
            // end, which is the same shape and the only cap the segment shader cannot
            // draw on its own.
            const grow = square && !loop ? half : 0;
            if (loop) {
                writeJoin(seam, 0, run[n - 2], run[0], run[1], half, style, miterLimit);
            }
            for (let s = 0; s < n - 1; s++) {
                const p = run[s];
                const q = run[s + 1];
                const [px, py] = grow > 0 && s === 0 ? along(p, q, -grow) : p;
                const [qx, qy] = grow > 0 && s === n - 2 ? along(q, p, -grow) : q;
                data[i] = px;
                data[i + 1] = py;
                data[i + 2] = qx;
                data[i + 3] = qy;
                data[i + 4] = r;
                data[i + 5] = g;
                data[i + 6] = b;
                data[i + 7] = a;
                data[i + 8] = width;
                data[i + REACH] = s === 1 && !loop ? segmentLength(run, 0, grow) : FAR_REACH;
                data[i + REACH + 1] = s === n - 3 && !loop ? segmentLength(run, n - 2, grow) : FAR_REACH;
                if (s > 0) {
                    // the vertex is shared, so both sides take the one join written for it
                    carryJoin(data, i + END_END - SEGMENT_STRIDE, i + START_END);
                }
                else if (loop) {
                    writeEnd(data, i + START_END, seam);
                }
                else {
                    writeEnd(data, i + START_END, startCap);
                }
                if (s < n - 2) {
                    writeJoin(data, i + END_END, p, q, run[s + 2], half, style, miterLimit);
                }
                else if (loop) {
                    writeEnd(data, i + END_END, seam);
                }
                else {
                    writeEnd(data, i + END_END, endCap);
                }
                i += SEGMENT_STRIDE;
            }
        }
        return i;
    }
    /** Length of segment `j` of a run, including what a square cap adds to it. */
    function segmentLength(run, j, grow) {
        const a = run[j];
        const b = run[j + 1];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        return grow > 0 && (j === 0 || j === run.length - 2) ? len + grow : len;
    }
    /** `from` moved `by` towards `to`, or away from it when `by` is negative. */
    function along(from, to, by) {
        const dx = to[0] - from[0];
        const dy = to[1] - from[1];
        const len = Math.hypot(dx, dy);
        if (len < 1e-9) {
            return from;
        }
        return [from[0] + (dx / len) * by, from[1] + (dy / len) * by];
    }
    /**
     * Cut-back caps for run ends that meet, indexed as [start, end] per run.
     *
     * Only for a round cap, and only where two ends sit closer together than the
     * stroke is wide, which is every dash gap under that width. Each is cut at the
     * plane halfway to the other, which for equal radii is the union's own outline,
     * so neither draws over it. Around a corner as readily as along a straight run,
     * since the cut follows the line between the two ends and not either direction.
     */
    function capMeetings(runs, width, cap) {
        const out = [];
        if (cap[3] !== KIND_ROUND_CAP || width <= 0) {
            return out;
        }
        for (let i = 1; i < runs.length; i++) {
            const before = runs[i - 1];
            const after = runs[i];
            if (before.length < 2 || after.length < 2) {
                continue;
            }
            const from = before[before.length - 1];
            const to = after[0];
            const gx = to[0] - from[0];
            const gy = to[1] - from[1];
            const gap = Math.hypot(gx, gy);
            if (gap <= 1e-9 || gap >= width) {
                continue;
            }
            const ux = gx / gap;
            const uy = gy / gap;
            // a hair apart, so a pixel centred on the plane goes to one of them
            out[(i - 1) * 2 + 1] = [ux, uy, gap / 2, KIND_CAP_MEET];
            out[i * 2] = [-ux, -uy, gap / 2 - 1e-4, KIND_CAP_MEET];
        }
        return out;
    }
    /** Copies the join written at `from` onto the segment starting at `to`. */
    function carryJoin(data, from, to) {
        data[to] = data[from];
        data[to + 1] = data[from + 1];
        data[to + 2] = data[from + 2];
        data[to + 3] = data[from + 3];
    }
    /**
     * vega nudges a group's border by half a pixel when the stroke is about one
     * pixel wide, so the hairline lands on one row of pixels instead of straddling
     * two. Only the background and border move, not the group's contents.
     */
    function withStrokeOffset(item) {
        const sw = item.strokeWidth ?? 1;
        const off = item.strokeOffset ?? (item.stroke && sw > 0.5 && sw < 1.5 ? 0.5 - Math.abs(sw - 1) : 0);
        return off === 0 ? item : { ...item, x: (item.x || 0) + off, y: (item.y || 0) + off };
    }
    /**
     * Rect and group strokes are drawn analytically in the fragment shader, which
     * can express neither a dash pattern nor a ramp. For either the border is
     * walked as a closed polyline instead and emitted as line instances, dashed
     * when a pattern is set and whole when it is not. Returns null when the item
     * has no border this has to draw.
     */
    function borderInstances(ctx, item, ramp) {
        if ((!dashPatternOf(item) && !ramp) || !item.stroke) {
            return null;
        }
        const [x, y, w, h] = rectBox(item);
        if (w <= 0 || h <= 0) {
            return null;
        }
        const outline = roundedBorder(ctx, item, x, y, w, h) ?? [
            [
                [x, y],
                [x + w, y],
                [x + w, y + h],
                [x, y + h],
                [x, y],
            ],
        ];
        const color = paintColour(item.stroke, item.opacity, item.strokeOpacity, ramp);
        return segmentInstances(strokeRuns(outline, item), color, item.strokeWidth ?? 1, strokeEnds(item));
    }
    const borderPath = vegaScenegraph.pathRectangle();
    /**
     * The border as contours, when a corner radius rounds it, and null when the box
     * is square and the four straight sides are already exact.
     *
     * The path comes from vega's own rect generator, so the curve, where it starts
     * and which way it runs are the ones canvas dashes along. Walking the box as
     * four straight sides instead gave a group with both a radius and a dash a
     * dashed sharp rectangle.
     */
    function roundedBorder(ctx, item, x, y, w, h) {
        const r = item.cornerRadius ?? 0;
        const tl = item.cornerRadiusTopLeft ?? r;
        const tr = item.cornerRadiusTopRight ?? r;
        const br = item.cornerRadiusBottomRight ?? r;
        const bl = item.cornerRadiusBottomLeft ?? r;
        if (tl <= 0 && tr <= 0 && br <= 0 && bl <= 0) {
            return null;
        }
        const path = borderPath.width(w).height(h).cornerRadius(tl, tr, br, bl)(item, x, y);
        return path ? geometryForPath(ctx, path, DASH_FLATNESS).lines : null;
    }
    /**
     * A per-context geometry cache, bounded so a streaming session, where every
     * frame brings new datum ids, cannot grow one without limit.
     */
    function geometryCache() {
        return new LruMap(4096);
    }
    /** Identifies an item across frames: vega keeps tuple ids on a symbol. */
    function itemKey(item) {
        if (item.datum?.id != null) {
            return item.datum.id;
        }
        if (item.id != null) {
            return item.id;
        }
        const symbols = Object.getOwnPropertySymbols(item);
        return symbols.length > 0 ? item[symbols[0]] : item;
    }
    /**
     * Vega mutates a Bounds in place as the view pans or zooms, so comparing by
     * identity never sees a change. Snapshot the numbers and compare those.
     */
    function copyBounds(b) {
        return b ? { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 } : undefined;
    }
    /**
     * A projection can send a shape outside its domain and leave NaN in its
     * bounds. Compared with `===` those items never match their own snapshot and
     * rebuild on every frame.
     */
    function sameBounds(b, snap) {
        if (!b || !snap) {
            return b === undefined && snap === undefined;
        }
        return sameEdge(b.x1, snap.x1) && sameEdge(b.y1, snap.y1) && sameEdge(b.x2, snap.x2) && sameEdge(b.y2, snap.y2);
    }
    function sameEdge(a, b) {
        return a === b || (Number.isNaN(a) && Number.isNaN(b));
    }
    function sameColor(a, b) {
        return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
    }
    /** Copies positions from `source` and writes `color` into every vertex. */
    function recolor(data, source, color) {
        for (let i = 0; i < data.length; i += GEOMETRY_STRIDE) {
            data[i] = source[i];
            data[i + 1] = source[i + 1];
            data[i + 2] = color[0];
            data[i + 3] = color[1];
            data[i + 4] = color[2];
            data[i + 5] = color[3];
        }
    }
    /**
     * The cache entry for an item whose geometry has not changed since it was
     * built. A colour-only change rewrites the colours over the cached positions
     * instead of triangulating again, and keeps them.
     */
    function cachedFill(cache, key, item, fill) {
        const entry = cache.get(key);
        if (!entry ||
            item.strokeWidth !== entry.strokeWidth ||
            item.x !== entry.x ||
            item.y !== entry.y ||
            item.path !== entry.path ||
            item.angle !== entry.angle ||
            item.scaleX !== entry.scaleX ||
            item.scaleY !== entry.scaleY ||
            !sameBounds(item.bounds, entry.bounds)) {
            return undefined;
        }
        if (!sameColor(entry.fill, fill)) {
            const data = new Float32Array(entry.data.length);
            recolor(data, entry.data, fill);
            entry.fill = fill;
            entry.data = data;
        }
        return entry;
    }
    /** Keeps an item's freshly built fill vertex data, for cachedFill to find. */
    function cacheFill(cache, key, item, fill, data, extra) {
        cache.set(key, {
            fill,
            x: item.x,
            y: item.y,
            bounds: copyBounds(item.bounds),
            strokeWidth: item.strokeWidth,
            path: item.path,
            angle: item.angle,
            scaleX: item.scaleX,
            scaleY: item.scaleY,
            data,
            extra,
        });
    }
    /** The item's fill vertex data, building it only when the geometry changed. */
    function cachedGeometryData(cache, key, item, fill, build) {
        const entry = cachedFill(cache, key, item, fill);
        if (entry) {
            return entry.data;
        }
        const data = build();
        cacheFill(cache, key, item, fill, data, undefined);
        return data;
    }

    /**
     * arc and path: marks that triangulate one shape per item, fill it, and walk
     * its contours for the stroke.
     *
     * The two differ in where the shape comes from, whether the item carries a
     * transform of its own and whether the triangulation is worth holding. Paint
     * order, batching, the gradient routes and the outline are the same, and had
     * been written out twice.
     */
    function itemShapeMark({ type, name, shapeOf, transformOf, cached, }) {
        function draw(device, ctx, scene, vb) {
            const items = markItems(scene);
            if (items.length === 0) {
                return;
            }
            const res = getMarkResources(ctx, type, device, vb, () => ({
                ...fillResources(ctx, device, vb, name),
                cache: geometryCache(),
            }));
            const uniformBuffer = res.bufferManager.createUniformBuffer();
            const fillTarget = targetOf(ctx, device, name, res, res.bufferManager, uniformBuffer);
            const outlineTarget = targetOf(ctx, device, res.outline.name, res.outline, res.bufferManager, uniformBuffer);
            // Solid fills share one draw in paint order, and a gradient fill or an
            // outline closes the run.
            const run = new DrawRun(ctx._opaqueBackdrop, (chunks, blend) => {
                const data = joinChunks(chunks);
                if (data) {
                    enqueueFill(fillTarget, data, null, blend);
                }
            });
            for (const item of items) {
                const blend = blendKey(item.blend);
                const fill = paintOf(item.fill, item.opacity, item.fillOpacity, item.bounds);
                const stroke = paintOf(item.stroke, item.opacity, item.strokeOpacity, item.bounds);
                const dash = dashPatternOf(item);
                const transform = transformOf?.(item);
                // Lazy, so a held fill never runs the generator, and shared, so the
                // stroke walks the contours the fill was built from.
                let held = null;
                const shape = () => (held ??= shapeOf(ctx, item));
                // The stroke is walked as segments, so it is left off the geometry. The
                // shape is generated around the origin, so the item centre is baked in.
                const strokeItem = { ...item, stroke: undefined };
                const build = () => {
                    const geometry = geometryForItem(ctx, strokeItem, shape(), false, item.x || 0, item.y || 0, transform);
                    return vertexData(geometry.fillTriangles, geometry.fillCount, fill.colour);
                };
                const fillData = cached ? cachedGeometryData(res.cache, itemKey(item), item, fill.colour, build) : build();
                if (fillData.length > 0 && fill.ramp) {
                    run.flush();
                    enqueueFill(fillTarget, fillData, fill.ramp, blend);
                }
                else {
                    run.add(fillData, blend);
                }
                // After the fill, which is the order canvas paints them in. Enqueued
                // ahead of it the fill covers the inner half of every dash.
                if (item.stroke) {
                    const lines = dash ? shapeOf(ctx, item, DASH_FLATNESS).lines : shape().lines;
                    const data = segmentInstances(strokeRuns(lines, item, { dx: item.x || 0, dy: item.y || 0, ...transform }), stroke.colour, item.strokeWidth ?? 1, strokeEnds(item));
                    if (data) {
                        run.flush();
                        enqueueOutline(outlineTarget, data, stroke.ramp, blend);
                    }
                }
            }
            run.flush();
        }
        return { draw };
    }

    var arc = itemShapeMark({ type: 'arc', name: 'Arc', shapeOf: arc$1 });

    /**
     * area and trail are the two marks whose items are one shape rather than one
     * each: the mark carries a single set of styles, the fill is one
     * triangulation, and the stroke is one walk of its contours.
     */
    function oneShapeMark({ type, name, shapeOf, maskOutline }) {
        function draw(device, ctx, scene, vb) {
            const items = scene.items;
            if (!items?.length) {
                return;
            }
            const res = getMarkResources(ctx, type, device, vb, () => fillResources(ctx, device, vb, name));
            const item = items[0];
            const blend = blendKey(item.blend);
            const bounds = scene.bounds ?? item.bounds;
            const fill = paintOf(item.fill, item.opacity, item.fillOpacity, bounds);
            const stroke = paintOf(item.stroke, item.opacity, item.strokeOpacity, bounds);
            // The stroke is walked as segments, so it is left off the geometry.
            const dash = dashPatternOf(item);
            const shapeGeom = shapeOf(ctx, items);
            const geometry = geometryForItem(ctx, { ...item, stroke: undefined }, shapeGeom, true);
            const fillData = heldVertexData(geometry.fillTriangles, geometry.fillCount, fill.colour);
            const uniformBuffer = res.bufferManager.createUniformBuffer();
            const fillTarget = targetOf(ctx, device, name, res, res.bufferManager, uniformBuffer);
            if (fillData.length > 0) {
                enqueueFill(fillTarget, fillData, fill.ramp, blend);
            }
            // After the fill, which is the order canvas paints them in.
            if (item.stroke) {
                const lines = dash ? shapeOf(ctx, items, DASH_FLATNESS).lines : shapeGeom.lines;
                const data = segmentInstances(strokeRuns(lines, item), stroke.colour, item.strokeWidth ?? 1, strokeEnds(item));
                if (data) {
                    const outline = targetOf(ctx, device, res.outline.name, res.outline, res.bufferManager, uniformBuffer);
                    // A ramp cannot be read back out of a coverage mask, so a gradient
                    // stroke goes band by band whatever the mark asked for.
                    if (!maskOutline || stroke.ramp) {
                        enqueueOutline(outline, data, stroke.ramp, blend);
                    }
                    else {
                        enqueueMaskedOutline(outline, data, blend, stroke.colour, strokeReach(item));
                    }
                }
            }
        }
        return { draw };
    }

    var area = oneShapeMark({ type: 'area', name: 'Area', shapeOf: area$1, maskOutline: false });

    /** Two-triangle unit quad, as [x, y] pairs. */
    const quadVertex = Float32Array.from([0, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 1]);

    const drawName$7 = 'Rect';
    function rectResources(ctx, device, vb, name) {
        return getMarkResources(ctx, name.toLowerCase(), device, vb, () => {
            const bufferManager = new BufferManager(device, name);
            const vertexManager = new VertexBufferManager(['float32x2'], // position
            // center, dimensions, fill color, stroke color, stroke width, corner radii
            ['float32x2', 'float32x2', 'float32x4', 'float32x4', 'float32', 'float32x4']);
            return {
                device,
                name,
                bufferManager,
                pipelineFor: blendPipelines(ctx, device, name, 'Rect', vertexManager),
                // a gradient fill under a blend needs its own pipeline too
                gradientPipelineFor: blendPipelines(ctx, device, `${name}Gradient`, 'Rect', vertexManager, 'main_fragment_gradient'),
                geometryBuffer: bufferManager.createGeometryBuffer(quadVertex, true),
                // The analytic stroke cannot express a pattern, so a dashed border is
                // walked as a polyline and drawn as segments.
                outline: outlinePipelines(ctx, device, `${name}Dash`),
            };
        });
    }
    /**
     * Draws boxes in the order they are painted: fills in runs, and a ramp fill or
     * a border drawn as segments on its own.
     */
    class BoxPainter {
        res;
        fill;
        outline;
        run;
        constructor(ctx, device, res) {
            this.res = res;
            const uniformBuffer = res.bufferManager.createUniformBuffer();
            this.fill = targetOf(ctx, device, res.name, res, res.bufferManager, uniformBuffer);
            this.outline = targetOf(ctx, device, res.outline.name, res.outline, res.bufferManager, uniformBuffer);
            this.run = new DrawRun(ctx._opaqueBackdrop, (boxes, blend) => this.enqueue(boxes, null, blend));
        }
        /** A box's fill, and its stroke when the analytic one draws it. */
        paint(box, fillRamp, blend) {
            if (fillRamp) {
                this.run.flush();
                this.enqueue([box], fillRamp, blend);
            }
            else {
                this.run.add(box, blend);
            }
        }
        /** A border drawn as segments, over everything painted before it. */
        border(data, ramp, blend) {
            this.run.flush();
            enqueueOutline(this.outline, data, ramp, blend);
        }
        flush() {
            this.run.flush();
        }
        enqueue(boxes, ramp, blend) {
            const instances = this.res.bufferManager.createInstanceBuffer(rectAttributes(boxes, ramp !== null));
            enqueueDraw(this.fill, ramp, blend, [6, boxes.length], [this.res.geometryBuffer, instances]);
        }
    }
    function draw$7(device, ctx, scene, vb) {
        const items = markItems(scene);
        if (items.length === 0) {
            return;
        }
        const painter = new BoxPainter(ctx, device, rectResources(ctx, device, vb, drawName$7));
        for (const item of items) {
            const blend = blendKey(item.blend);
            const strokeRamp = boxRampOf(item.stroke, item);
            const border = borderInstances(ctx, item, strokeRamp);
            // A dash or a ramp takes the border off the analytic path, and the stroke
            // comes off the fill with it so it is not drawn solid underneath. The fill
            // goes first, which is the order canvas paints them in.
            painter.paint(border ? { ...item, stroke: undefined } : item, boxRampOf(item.fill, item), blend);
            if (border) {
                painter.border(border, strokeRamp, blend);
            }
        }
        painter.flush();
    }
    /** Floats per rect instance: box, fill, stroke, stroke width, four radii. */
    const RECT_STRIDE = 17;
    function rectAttributes(items, whiteGradientFill = false) {
        const out = instanceScratch(items.length * RECT_STRIDE);
        for (let i = 0, len = items.length; i < len; i++) {
            const item = items[i];
            const { opacity = 1, fill, fillOpacity = 1, stroke, strokeOpacity = 1, strokeWidth, cornerRadius = 0, cornerRadiusBottomLeft, cornerRadiusBottomRight, cornerRadiusTopRight, cornerRadiusTopLeft, } = item;
            // a quad built from a negative extent would be inverted and draw nothing
            const [x, y, width, height] = rectBox(item);
            const base = i * RECT_STRIDE;
            out[base] = x;
            out[base + 1] = y;
            out[base + 2] = width;
            out[base + 3] = height;
            if (whiteGradientFill && isGradient(fill)) {
                const [r, g, b, a] = whiteCarrier(opacity, fillOpacity);
                out[base + 4] = r;
                out[base + 5] = g;
                out[base + 6] = b;
                out[base + 7] = a;
            }
            else {
                Color.write(out, base + 4, fill, opacity, fillOpacity);
            }
            Color.write(out, base + 8, stroke, opacity, strokeOpacity);
            // Only reserve stroke width when a stroke is actually painted. Vega marks
            // may carry a strokeWidth with no stroke (e.g. stroke set on hover only);
            // canvas ignores it, so we must too. Otherwise the transparent stroke
            // band insets the fill and the rect renders ~strokeWidth/2 px too small.
            out[base + 12] = stroke ? (strokeWidth ?? 1) : 0;
            out[base + 13] = cornerRadiusTopRight ?? cornerRadius;
            out[base + 14] = cornerRadiusBottomRight ?? cornerRadius;
            out[base + 15] = cornerRadiusBottomLeft ?? cornerRadius;
            out[base + 16] = cornerRadiusTopLeft ?? cornerRadius;
        }
        return out;
    }
    var rect = { draw: draw$7 };

    const drawName$6 = 'Group';
    function draw$6(device, ctx, scene, vb, markTypes) {
        const items = scene.items;
        if (!items?.length) {
            return;
        }
        // Group backgrounds share the rect instance layout and shader. Held borders
        // draw after their children, by which point the visit has put the clip back
        // to what it was, so every draw here takes the same one.
        const painter = new BoxPainter(ctx, device, rectResources(ctx, device, vb, drawName$6));
        /** Borders held back until after the backgrounds, which is the order canvas paints them in. */
        const dashed = [];
        // A group asking for strokeForeground has its border held back and enqueued
        // after its own children, which is where vega draws it.
        const held = new Map();
        /** One group's background, and the border that goes under its children. */
        const paintBackdrop = (item) => {
            const blend = blendKey(item.blend);
            const edged = withStrokeOffset(item);
            const strokeRamp = boxRampOf(item.stroke, item);
            const border = borderInstances(ctx, edged, strokeRamp);
            const fore = item.strokeForeground === true && item.stroke != null;
            if (fore) {
                held.set(item, { rect: { ...edged, fill: undefined }, dash: border, ramp: strokeRamp });
            }
            else if (border) {
                dashed.push({ data: border, ramp: strokeRamp, blend });
            }
            const drawn = border || fore ? { ...edged, stroke: undefined } : edged;
            // a backdrop with neither is a quad that draws nothing
            if (drawn.fill || drawn.stroke) {
                painter.paint(drawn, boxRampOf(drawn.fill, item), blend);
            }
        };
        const flushBackdrops = () => {
            painter.flush();
            for (const entry of dashed) {
                painter.border(entry.data, entry.ramp, entry.blend);
            }
            dashed.length = 0;
        };
        // vega draws each group's background, then its children, then the next group.
        // Every background in one instanced draw reverses that wherever a later group
        // covers what an earlier one drew, so the batch is kept only when nothing
        // overlaps, which is what a row of panels looks like.
        const interleaved = groupsOverlap(items);
        if (!interleaved) {
            for (const item of items) {
                paintBackdrop(item);
            }
            flushBackdrops();
        }
        vegaScenegraph.sceneVisit(scene, (group) => {
            if (interleaved) {
                paintBackdrop(group);
                flushBackdrops();
            }
            const gx = group.x || 0;
            const gy = group.y || 0;
            // accumulate the group translation for nested marks
            ctx._tx += gx;
            ctx._ty += gy;
            const oldClip = ctx._clip;
            const oldRound = ctx._clipRound;
            if (group.clip) {
                // A group item is cut to its own rectangle whatever its clip holds:
                // vega's group mark calls clipGroup, which never reads the value, so a
                // path there is the SVG renderer's route rather than anything canvas
                // draws.
                pushGroupClip(ctx, group);
            }
            vb.translate(-gx, -gy);
            vegaScenegraph.sceneVisit(group, (item) => this.draw(device, ctx, item, vb, markTypes));
            vb.translate(gx, gy);
            ctx._clip = oldClip;
            ctx._clipRound = oldRound;
            ctx._tx -= gx;
            ctx._ty -= gy;
            const fore = held.get(group);
            if (fore) {
                const blend = blendKey(fore.rect.blend);
                if (fore.dash) {
                    painter.border(fore.dash, fore.ramp, blend);
                }
                else {
                    painter.paint(fore.rect, null, blend);
                    painter.flush();
                }
            }
        });
    }
    /**
     * Whether any group's background lands on another's contents, so the order the
     * two are drawn in shows.
     *
     * A group's `bounds` covers its children as well as its own box, which is what
     * makes this more than a box test: a panel's axis labels reach outside it, and
     * the next panel's background paints over them.
     *
     * Pairwise, since a group mark is panels rather than data points. Past the
     * limit it answers yes without looking, which is the order vega draws in and
     * only costs the batch.
     */
    const OVERLAP_CHECK_LIMIT = 2048;
    function groupsOverlap(items) {
        const n = items.length;
        if (n < 2) {
            return false;
        }
        if (n > OVERLAP_CHECK_LIMIT) {
            return true;
        }
        for (let j = 0; j < n; j++) {
            const a = items[j];
            if (!paintsBackdrop(a)) {
                continue;
            }
            for (let i = 0; i < n; i++) {
                if (i !== j && reaches(a, items[i])) {
                    return true;
                }
            }
        }
        return false;
    }
    /** True when a group paints a backdrop under its children at all. */
    function paintsBackdrop(a) {
        return Boolean(a.fill || (a.stroke && a.strokeForeground !== true));
    }
    /** True when `a`'s box reaches into `b`. */
    function reaches(a, b) {
        const bounds = b.bounds;
        if (!bounds) {
            return false;
        }
        const x1 = a.x || 0;
        const y1 = a.y || 0;
        return x1 < bounds.x2 && x1 + (a.width || 0) > bounds.x1 && y1 < bounds.y2 && y1 + (a.height || 0) > bounds.y1;
    }
    var group = { draw: draw$6 };

    const drawName$5 = 'Image';
    function getResources$5(device, ctx, vb) {
        return getMarkResources(ctx, 'image', device, vb, () => {
            const bufferManager = new BufferManager(device, drawName$5);
            const vertexManager = new VertexBufferManager(['float32x2'], // position
            ['float32x2', 'float32x2', 'float32']);
            // a blend is baked into the pipeline state, so each mode needs its own
            const pipelineFor = blendPipelines(ctx, device, `${drawName$5}`, drawName$5, vertexManager);
            const geometryBuffer = bufferManager.createGeometryBuffer(quadVertex, true);
            const smoothSampler = device.createSampler({
                label: 'Image Sampler (smooth)',
                magFilter: 'linear',
                minFilter: 'linear',
                mipmapFilter: 'linear',
                // an image whose width and height are scaled differently reduces by a
                // different amount on each axis, and one level for both blurs the
                // shallower one by the difference
                maxAnisotropy: 16,
            });
            // Nearest at any scale is what a 2D context does with smoothing off, so
            // this one stays on the full resolution texels however far it is reduced.
            const pixelatedSampler = device.createSampler({
                label: 'Image Sampler (pixelated)',
                magFilter: 'nearest',
                minFilter: 'nearest',
                lodMaxClamp: 0,
            });
            return {
                device,
                bufferManager,
                pipelineFor,
                geometryBuffer,
                smoothSampler,
                pixelatedSampler,
                textures: new WeakMap(),
            };
        });
    }
    /**
     * Mirrors vega-scenegraph's image mark: kicks off an async load through the
     * renderer (which re-renders once the image arrives) and returns whatever is
     * available right now.
     */
    function getImage(item, renderer) {
        let image = item.image;
        if (!image || (item.url && item.url !== image.url)) {
            image = { complete: false, width: 0, height: 0 };
            renderer.loadImage(item.url ?? '').then(loaded => {
                item.image = loaded;
                item.image.url = item.url;
            });
        }
        return image;
    }
    function imageWidth(item, image) {
        return item.width != null
            ? item.width
            : !image || !image.width
                ? 0
                : item.aspect !== false && item.height
                    ? (item.height * image.width) / image.height
                    : image.width;
    }
    function imageHeight(item, image) {
        return item.height != null
            ? item.height
            : !image || !image.height
                ? 0
                : item.aspect !== false && item.width
                    ? (item.width * image.height) / image.width
                    : image.height;
    }
    function imageXOffset(align, w) {
        return align === 'center' ? w / 2 : align === 'right' ? w : 0;
    }
    function imageYOffset(baseline, h) {
        return baseline === 'middle' ? h / 2 : baseline === 'bottom' ? h : 0;
    }
    function uploadTexture(device, image) {
        const width = image.width || 1;
        const height = image.height || 1;
        const levels = Math.floor(Math.log2(Math.max(width, height))) + 1;
        const texture = imageTexture(device, 'Image Texture', width, height, levels);
        let source;
        if (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) {
            source = image;
        }
        else if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) {
            source = image;
        }
        else {
            // HTMLImageElement is not a valid copy source, so go through a 2D canvas.
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d');
            if (!context) {
                return texture;
            }
            context.drawImage(image, 0, 0);
            source = canvas;
        }
        // premultiplied, which is how canvas filters: straight alpha took a red
        // image with transparent white corners and lost its red near them
        uploadImage(device, source, texture, width, height);
        writeMipChain(device, texture, source, width, height, levels);
        return texture;
    }
    /**
     * Halves the image into every level below the first.
     *
     * A reduction reads four texels of whatever level it lands between, so without
     * a chain an icon drawn at a quarter of its size takes four of the sixteen
     * texels under each pixel and drops the rest. Canvas does not do that: at a
     * quarter it lands within a level of the average of all sixteen where a plain
     * bilinear read comes back empty along the edge.
     *
     * Every level is drawn from the original rather than from the one above it, so
     * each is the image reduced once through the 2D context canvas itself reduces
     * through. Halving repeatedly compounds the filter instead, which comes out
     * softer than canvas at every level past the first.
     */
    function writeMipChain(device, texture, image, width, height, levels) {
        for (let level = 1; level < levels; level++) {
            const w = Math.max(1, width >> level);
            const h = Math.max(1, height >> level);
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const context = canvas.getContext('2d');
            if (!context) {
                return;
            }
            context.imageSmoothingEnabled = true;
            context.drawImage(image, 0, 0, w, h);
            uploadImage(device, canvas, texture, w, h, [0, 0], level);
        }
    }
    function getBindGroup(res, image, smooth, pipeline, blend) {
        let entry = res.textures.get(image);
        if (!entry) {
            entry = { texture: uploadTexture(res.device, image), bindGroups: new Map() };
            res.textures.set(image, entry);
        }
        const key = `${smooth ? 'smooth' : 'pixelated'}|${blend}`;
        let bindGroup = entry.bindGroups.get(key);
        if (!bindGroup) {
            bindGroup = textureBindGroup(res.device, `Image Texture Bind Group (${key})`, pipeline, smooth ? res.smoothSampler : res.pixelatedSampler, viewOf(entry.texture));
            entry.bindGroups.set(key, bindGroup);
        }
        return bindGroup;
    }
    function draw$5(device, ctx, scene, vb) {
        const items = markItems(scene);
        if (items.length === 0) {
            return;
        }
        const res = getResources$5(device, ctx, vb);
        const uniformBuffer = res.bufferManager.createUniformBuffer();
        for (const item of items) {
            const image = getImage(item, this);
            let w = imageWidth(item, image);
            let h = imageHeight(item, image);
            // A url that failed to load leaves a complete image carrying no pixels,
            // and drawing one of those throws rather than drawing nothing, which
            // costs the whole frame over one bad url.
            if (w === 0 || h === 0 || !image.width || !image.height || !(image.complete || image.toDataURL)) {
                continue; // not loaded yet, or never will be; the renderer re-renders on arrival
            }
            let x = (item.x || 0) - imageXOffset(item.align, w);
            let y = (item.y || 0) - imageYOffset(item.baseline, h);
            // letterbox into the given box when aspect is preserved
            if (item.aspect !== false && item.width && item.height) {
                const ar0 = image.width / image.height;
                const ar1 = item.width / item.height;
                if (ar0 === ar0 && ar1 === ar1 && ar0 !== ar1) {
                    if (ar1 < ar0) {
                        const t = w / ar0;
                        y += (h - t) / 2;
                        h = t;
                    }
                    else {
                        const t = h * ar0;
                        x += (w - t) / 2;
                        w = t;
                    }
                }
            }
            const instanceBuffer = res.bufferManager.createInstanceBuffer(Float32Array.from([x, y, w, h, item.opacity ?? 1]));
            // a pipeline with a default layout owns its bind group layout, so the
            // groups have to come from the blend variant this draw uses
            const blend = blendKey(item.blend);
            const imagePipeline = res.pipelineFor(blend);
            ctx._renderQueue.enqueue({
                pipeline: imagePipeline,
                drawCounts: [6, 1],
                vertexBuffers: [res.geometryBuffer, instanceBuffer],
                bindGroups: [
                    uniformBindGroup(ctx, device, drawName$5, imagePipeline, uniformBuffer),
                    getBindGroup(res, image, item.smooth !== false, imagePipeline, blend),
                ],
                clip: ctx._clip,
            });
        }
    }
    var image = { draw: draw$5 };

    const drawName$4 = 'Line';
    /**
     * The two cubics the GPU evaluates, each with the shader that reads its control
     * points and the packer that produces them.
     */
    const CURVES = {
        basis: { shader: 'Curve:basis', instances: basisInstances },
        bezier: { shader: 'Curve:bezier', instances: bezierInstances },
    };
    function getResources$4(device, ctx, vb) {
        return getMarkResources(ctx, 'line', device, vb, () => {
            const bufferManager = new BufferManager(device, drawName$4);
            const outline = outlinePipelines(ctx, device, drawName$4);
            const spanVertexManager = new VertexBufferManager([], 
            // p0, p1, p2, p3, color, stroke width, kind
            ['float32x2', 'float32x2', 'float32x2', 'float32x2', 'float32x4', 'float32', 'float32']);
            return {
                spanVertexManager,
                spanBindGroups: new Map(),
                device,
                bufferManager,
                outline,
                segmentBindGroup: null,
            };
        });
    }
    /**
     * Queues segment instances into the shared batch. The batch only merges draws
     * whose bind groups are the same object, so it is held rather than rebuilt.
     */
    function queueSegments(device, ctx, res, rows, blend = 'normal') {
        const pipeline = res.outline.pipelineFor(blend);
        const buffer = res.bufferManager.sharedUniformBuffer();
        // Keyed by the pipeline as well as the buffer. A bind group belongs to the
        // layout it was made from, so holding one across a change of blend set a
        // group from the normal pipeline on the blended one, which invalidates the
        // whole command buffer: a scene mixing a blended line with an unblended one
        // came out empty, every mark of it.
        const mask = clipMaskView(ctx, device);
        const held = res.segmentBindGroup;
        const entry = held !== null && held.buffer === buffer && held.pipeline === pipeline && held.mask === mask
            ? held
            : {
                group: createUniformBindGroup(drawName$4, device, pipeline, buffer, mask),
                buffer,
                pipeline,
                mask,
            };
        res.segmentBindGroup = entry;
        ctx._renderQueue.setupBatch({
            device,
            vertexManager: res.outline.vertexManager,
            pipeline,
            clip: ctx._clip,
            bindGroups: [entry.group],
        });
        ctx._renderQueue.queueBatchInstance(rows);
    }
    /** True when the points can be drawn as they are, with no curve and no gaps. */
    function isPolyline(points) {
        const interpolate = points[0]?.interpolate;
        return (!interpolate || interpolate === 'linear') && points.every(p => p.defined !== false);
    }
    /** Which cubic each interpolation is. Anything absent is walked as segments. */
    const CURVE_OF = {
        basis: 'basis',
        bundle: 'basis',
        cardinal: 'bezier',
        'catmull-rom': 'bezier',
        monotone: 'bezier',
        natural: 'bezier',
    };
    /**
     * The cubic an undashed line goes to the GPU as, so the stroke follows the real
     * curve instead of a flattened polyline, or null for a line that is walked as
     * segments instead: linear, the step family and a line with gaps.
     *
     * The curve shaders draw no cap of their own. A square one is walked, which
     * draws it exactly. A round one stays on the curve and `drawCurve` adds the two
     * discs, since flattening the curve is further from canvas than a cap is worth.
     */
    function curveOf(points) {
        const interpolate = points[0]?.interpolate;
        const curve = interpolate === undefined ? undefined : CURVE_OF[interpolate];
        const whole = points.every(p => p.defined !== false);
        const square = points[0]?.strokeCap === 'square';
        if (!square && curve === 'basis' && points.length >= 3 && whole) {
            return 'basis';
        }
        if (!square && curve === 'bezier' && points.length >= 2) {
            return 'bezier';
        }
        return null;
    }
    /**
     * Every line the curve shaders do not draw, walked on the cpu and drawn as
     * segments, which is what gives every corner its join and every run its caps.
     * A polyline is walked as it is and anything curved or gapped along the path
     * tessellation's contours, a dash cuts the walk into runs, and a ramp colours
     * it from the gradient.
     */
    function drawOutline(device, ctx, res, points, ramp) {
        const first = points[0];
        const polylines = isPolyline(points)
            ? [points.map(p => [p.x || 0, p.y || 0])]
            : line$1(ctx, points).lines;
        const col = paintColour(first.stroke, first.opacity, first.strokeOpacity, ramp);
        const data = segmentInstances(strokeRuns(polylines, first), col, first.strokeWidth ?? 1, strokeEnds(first));
        if (!data) {
            return;
        }
        const blend = blendKey(first.blend);
        if (!ramp) {
            queueSegments(device, ctx, res, data, blend);
            return;
        }
        enqueueOutline(targetOf(ctx, device, res.outline.name, res.outline, res.bufferManager, res.bufferManager.sharedUniformBuffer()), data, ramp, blend);
    }
    /**
     * Instance data for one curve: a span per B-spline segment plus the two
     * straight runs d3's basis opens and closes with. Control points are doubled
     * at each end, which is what puts the first span's start at (5*P0 + P1) / 6.
     *
     * `bundle` blends every point toward the straight chord by its tension first,
     * exactly as d3 does before running basis.
     */
    function basisInstances(points, stubs) {
        const out = [];
        const first = points[0];
        const n = points.length;
        const beta = first.interpolate === 'bundle' ? (first.tension ?? 0.85) : 1;
        const xs = new Float64Array(n);
        const ys = new Float64Array(n);
        const x0 = points[0].x || 0;
        const y0 = points[0].y || 0;
        const dx = (points[n - 1].x || 0) - x0;
        const dy = (points[n - 1].y || 0) - y0;
        for (let i = 0; i < n; i++) {
            const px = points[i].x || 0;
            const py = points[i].y || 0;
            if (beta === 1) {
                xs[i] = px;
                ys[i] = py;
            }
            else {
                const t = i / (n - 1);
                xs[i] = beta * px + (1 - beta) * (x0 + t * dx);
                ys[i] = beta * py + (1 - beta) * (y0 + t * dy);
            }
        }
        const col = Color.from(first.stroke, first.opacity, first.strokeOpacity);
        const width = first.strokeWidth ?? 1;
        // controls, doubled at both ends
        const cx = [xs[0], ...xs, xs[n - 1]];
        const cy = [ys[0], ...ys, ys[n - 1]];
        const push = (ax, ay, bx, by, ccx, ccy, ddx, ddy, kind) => {
            out.push(ax, ay, bx, by, ccx, ccy, ddx, ddy, col[0], col[1], col[2], col[3], width, kind);
        };
        const basis = (i, t, axis) => {
            const t2 = t * t;
            const t3 = t2 * t;
            return (((1 - 3 * t + 3 * t2 - t3) * axis[i] +
                (4 - 6 * t2 + 3 * t3) * axis[i + 1] +
                (1 + 3 * t + 3 * t2 - 3 * t3) * axis[i + 2] +
                t3 * axis[i + 3]) /
                6);
        };
        // the straight run into the first knot
        const knot0 = [basis(0, 0, cx), basis(0, 0, cy)];
        push(xs[0], ys[0], knot0[0], knot0[1], 0, 0, 0, 0, 1);
        const spans = cx.length - 3;
        for (let i = 0; i < spans; i++) {
            push(cx[i], cy[i], cx[i + 1], cy[i + 1], cx[i + 2], cy[i + 2], cx[i + 3], cy[i + 3], 0);
        }
        // and the straight run out of the last
        const knotN = [basis(spans - 1, 1, cx), basis(spans - 1, 1, cy)];
        push(knotN[0], knotN[1], xs[n - 1], ys[n - 1], 0, 0, 0, 0, 1);
        // basis takes a whole line, so there is one run and these are its ends
        const head = [xs[0], ys[0]];
        const tail = [xs[n - 1], ys[n - 1]];
        stubs.open(head, [[knot0[0] - head[0], knot0[1] - head[1]]]);
        stubs.extend(tail, [[tail[0] - knotN[0], tail[1] - knotN[1]]]);
        return out;
    }
    /**
     * Instance data for a curve d3 writes as cubic Beziers, collected from the same
     * generator canvas draws through, so the control points are exactly its own.
     * A `moveTo` starts a run, which is how `defined: false` leaves its gaps.
     */
    function bezierInstances(points, stubs) {
        const out = [];
        const first = points[0];
        const col = Color.from(first.stroke, first.opacity, first.strokeOpacity);
        const width = first.strokeWidth ?? 1;
        let cx = 0;
        let cy = 0;
        // A moveTo starts a run, which is how `defined: false` leaves its gaps, and
        // canvas caps every run rather than only the first and the last.
        let opening = false;
        const leave = (towards) => {
            if (opening) {
                stubs.open([cx, cy], towards);
                opening = false;
            }
        };
        lineSpans(points, {
            moveTo(x, y) {
                cx = x;
                cy = y;
                opening = true;
            },
            lineTo(x, y) {
                leave([[x - cx, y - cy]]);
                out.push(cx, cy, x, y, 0, 0, 0, 0, col[0], col[1], col[2], col[3], width, 1);
                stubs.extend([x, y], [[x - cx, y - cy]]);
                cx = x;
                cy = y;
            },
            bezierCurveTo(x1, y1, x2, y2, x, y) {
                leave([
                    [x1 - cx, y1 - cy],
                    [x2 - cx, y2 - cy],
                    [x - cx, y - cy],
                ]);
                out.push(cx, cy, x1, y1, x2, y2, x, y, col[0], col[1], col[2], col[3], width, 0);
                stubs.extend([x, y], [
                    [x - x2, y - y2],
                    [x - x1, y - y1],
                    [x - cx, y - cy],
                ]);
                cx = x;
                cy = y;
            },
            closePath() { },
        });
        return out;
    }
    /**
     * How far a cap stub runs past its end point, in scene units. The disc is
     * centred on the far end, so this is also how much further the cap reaches
     * than canvas draws it, which at a tenth of a device pixel is under the grid.
     */
    const CAP_STUB = 0.05;
    /** Unit vector along the first of these that has a length, or null. */
    function firstDirection(deltas) {
        for (const [dx, dy] of deltas) {
            const len = Math.hypot(dx, dy);
            if (len > 1e-9) {
                return [dx / len, dy / len];
            }
        }
        return null;
    }
    /**
     * Collects the round caps a curve route does not draw.
     *
     * The curve shaders cover the stroke across its width and stop at the end
     * points, so the disc canvas adds at each end of each run has to come from
     * somewhere else. Each is a two point stub along the end tangent, pointing
     * away from the curve, drawn through the segment shader with a butt at the end
     * point and a round cap at the far end. The butt keeps it to the half beyond
     * the curve: a whole disc would sit over the curve body as well and composite
     * twice there under any mode that reads the frame back.
     *
     * The writers report their own runs rather than the stubs being read back out
     * of the instance rows. A basis span carries four B-spline control points, and
     * a span starts at (P0 + 4*P1 + P2) / 6 rather than at P0, so rows alone
     * cannot say where one run ends and the next begins.
     */
    class CapStubs {
        stubs = [];
        at = null;
        from = null;
        /**
         * A run leaves `at`, heading along the first of `towards` that has a length.
         * A cubic can repeat its endpoint as a control point, so the tangent is a
         * list rather than one delta: taking the first alone leaves that end with no
         * cap at all.
         */
        open(at, towards) {
            this.close();
            const ahead = firstDirection(towards);
            this.at = at;
            this.from = ahead && [-ahead[0], -ahead[1]];
        }
        /** The run now reaches `at`, arriving along the first of `towards`. */
        extend(at, towards) {
            this.last = { at, direction: firstDirection(towards) };
        }
        last = null;
        push(at, outward) {
            if (outward) {
                this.stubs.push([at, [at[0] + outward[0] * CAP_STUB, at[1] + outward[1] * CAP_STUB]]);
            }
        }
        close() {
            if (this.at && this.last) {
                this.push(this.at, this.from);
                this.push(this.last.at, this.last.direction);
            }
            this.at = null;
            this.last = null;
        }
        done() {
            this.close();
            return this.stubs;
        }
    }
    /**
     * Draws a cubic entirely on the GPU, with no tessellation. Batched, so a spec
     * whose curves are one faceted mark each still issues a single draw.
     */
    function drawCurve(device, ctx, res, points, kind) {
        const first = points[0];
        if (!first.stroke || (first.strokeWidth ?? 1) <= 0) {
            return;
        }
        const stubs = new CapStubs();
        const rows = CURVES[kind].instances(points, stubs);
        if (rows.length === 0) {
            return;
        }
        const blend = blendKey(first.blend);
        const pipeline = markPipeline(ctx, device, `${drawName$4} ${kind} ${blend}`, CURVES[kind].shader, res.spanVertexManager, undefined, blend);
        // The batch only merges draws whose bind groups are the same object, so this
        // is held rather than rebuilt per curve. Keyed by the pipeline as well, since
        // a bind group belongs to the layout it was made from.
        const buffer = res.bufferManager.sharedUniformBuffer();
        const cacheKey = `${kind}|${blend}`;
        const mask = clipMaskView(ctx, device);
        let held = res.spanBindGroups.get(cacheKey);
        if (!held || held.buffer !== buffer || held.pipeline !== pipeline || held.mask !== mask) {
            held = {
                group: createUniformBindGroup(`${drawName$4} ${kind}`, device, pipeline, buffer, mask),
                buffer,
                pipeline,
                mask,
            };
            res.spanBindGroups.set(cacheKey, held);
        }
        ctx._renderQueue.setupBatch({
            device,
            vertexManager: res.spanVertexManager,
            pipeline,
            clip: ctx._clip,
            vertexCount: 6 * CURVE_SUBDIVISIONS,
            bindGroups: [held.group],
        });
        ctx._renderQueue.queueBatchInstance(rows);
        if (first.strokeCap === 'round') {
            const caps = segmentInstances(stubs.done(), Color.from(first.stroke, first.opacity, first.strokeOpacity), first.strokeWidth ?? 1, { ...strokeEnds(first), caps: [BUTT_END, ROUND_END] });
            if (caps) {
                queueSegments(device, ctx, res, caps, blend);
            }
        }
    }
    function draw$4(device, ctx, scene, vb) {
        const items = scene.items;
        if (!items?.length) {
            return;
        }
        const res = getResources$4(device, ctx, vb);
        const points = items;
        const first = points[0];
        // A dash or a ramp cannot come out of the curve shaders, so a dashed or a
        // gradient stroke is walked like the lines they do not draw.
        const strokeRamp = rampOf(first.stroke, scene.bounds ?? first.bounds);
        const curve = dashPatternOf(first) || strokeRamp ? null : curveOf(points);
        if (curve) {
            drawCurve(device, ctx, res, points, curve);
        }
        else {
            drawOutline(device, ctx, res, points, strokeRamp);
        }
    }
    var line = { draw: draw$4 };

    var path = itemShapeMark({
        type: 'path',
        name: 'Path',
        // vega scales the path commands inside pathRender and rotates the context
        // around them, so the scale belongs to the geometry rather than to the
        // transform applied after it. That matters for an elliptical arc: vega
        // scales rx and ry and leaves the x axis rotation alone, which is a
        // different ellipse from the affine scale of the flattened curve.
        shapeOf: (ctx, item, scale) => geometryForPath(ctx, item.path, scale, item.scaleX ?? 1, item.scaleY ?? 1),
        transformOf: item => ({
            angle: itemTurn(item),
            scaleX: 1,
            scaleY: 1,
        }),
        cached: true,
    });

    const drawName$3 = 'Rule';
    function getResources$3(device, ctx, vb) {
        return getMarkResources(ctx, 'rule', device, vb, () => {
            const bufferManager = new BufferManager(device, drawName$3);
            const vertexManager = new VertexBufferManager(['float32x2'], // position
            // center, scale, color, half-thickness offset
            ['float32x2', 'float32x2', 'float32x4', 'float32x2']);
            const pipelineFor = blendPipelines(ctx, device, drawName$3, drawName$3, vertexManager);
            // A rule with both x2 and y2 set is a diagonal segment, which an
            // axis-aligned quad cannot express. Those go through the single-segment
            // line shader instead.
            const outline = outlinePipelines(ctx, device, `${drawName$3}Diagonal`);
            const geometryBuffer = bufferManager.createGeometryBuffer(quadVertex, true);
            return {
                device,
                bufferManager,
                pipelineFor,
                outline,
                geometryBuffer,
            };
        });
    }
    /** A rule's two ends. An unset x2 or y2 is its start, the way vega draws one. */
    function ruleEnds(item) {
        const x = item.x || 0;
        const y = item.y || 0;
        return [x, y, item.x2 == null ? x : item.x2 || 0, item.y2 == null ? y : item.y2 || 0];
    }
    /**
     * A rule drawn through the segment shader, for what the rect cannot draw: a
     * dash, a diagonal, a cap or a ramp. The rule is two points, so the walk the
     * line mark dashes with covers it. The raw ends: writeSegments lengthens a
     * square capped run itself, and a dash cuts it into runs whose inner ends are
     * not caps at all.
     */
    function segmentAttributes(item, color) {
        const [x, y, ex, ey] = ruleEnds(item);
        const line = [
            [x, y],
            [ex, ey],
        ];
        return segmentInstances(strokeRuns([line], item), color, item.strokeWidth ?? 1, strokeEnds(item));
    }
    /** True when the rule has no length, so canvas draws nothing under a butt cap. */
    function isDegenerate(item) {
        const x = item.x || 0;
        const y = item.y || 0;
        return (item.x2 ?? x) === x && (item.y2 ?? y) === y;
    }
    /** True when the rule runs at an angle, so it cannot be drawn as a rect. */
    function isDiagonal(item) {
        const x = item.x || 0;
        const y = item.y || 0;
        return (item.x2 ?? x) !== x && (item.y2 ?? y) !== y;
    }
    function draw$3(device, ctx, scene, vb) {
        const items = markItems(scene);
        if (items.length === 0) {
            return;
        }
        const res = getResources$3(device, ctx, vb);
        const uniformBuffer = res.bufferManager.createUniformBuffer();
        const outlineTarget = targetOf(ctx, device, res.outline.name, res.outline, res.bufferManager, uniformBuffer);
        const run = new DrawRun(ctx._opaqueBackdrop, (rules, blend) => {
            const pipeline = res.pipelineFor(blend);
            const instanceBuffer = res.bufferManager.createInstanceBuffer(createAttributes(rules));
            ctx._renderQueue.enqueue({
                pipeline,
                drawCounts: [6, rules.length],
                vertexBuffers: [res.geometryBuffer, instanceBuffer],
                bindGroups: [uniformBindGroup(ctx, device, drawName$3, pipeline, uniformBuffer)],
                clip: ctx._clip,
            });
        });
        for (const item of items) {
            const blend = blendKey(item.blend);
            const pattern = dashPatternOf(item);
            // The rect shader draws a rule with a butt end and a solid colour, so a cap
            // or a ramp takes the segment path the diagonal and dashed ones take.
            const strokeRamp = rampOf(item.stroke, item.bounds);
            const shaped = item.strokeCap === 'round' || item.strokeCap === 'square';
            // canvas moves to the point and lines to the same point, which a butt cap
            // renders as nothing. Falling back to the stroke width for both extents
            // would paint a square block instead.
            if (!shaped && isDegenerate(item)) {
                continue;
            }
            if (!pattern && !isDiagonal(item) && !strokeRamp && !shaped) {
                run.add(item, blend);
                continue;
            }
            run.flush();
            const color = paintColour(item.stroke, item.opacity, item.strokeOpacity, strokeRamp);
            const data = segmentAttributes(item, color);
            if (!data) {
                continue; // a zero length rule, or a dash that left nothing drawn
            }
            enqueueOutline(outlineTarget, data, strokeRamp, blend);
        }
        run.flush();
    }
    /** Floats per rule instance: corner, size, colour, and the offset a half stroke takes. */
    const RULE_STRIDE = 10;
    function createAttributes(items) {
        const out = instanceScratch(items.length * RULE_STRIDE);
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const { stroke, strokeWidth = 1, opacity = 1, strokeOpacity = 1 } = item;
            const [x, y, ex, ey] = ruleEnds(item);
            const ax = Math.abs(ex - x);
            const ay = Math.abs(ey - y);
            const base = i * RULE_STRIDE;
            out[base] = Math.min(x, ex);
            out[base + 1] = Math.min(y, ey);
            out[base + 2] = ax ? ax : strokeWidth;
            out[base + 3] = ay ? ay : strokeWidth;
            Color.write(out, base + 4, stroke, opacity, strokeOpacity);
            out[base + 8] = ax ? 0 : strokeWidth / 2;
            out[base + 9] = ay ? 0 : strokeWidth / 2;
        }
        return out;
    }
    var rule = { draw: draw$3 };

    const drawName$2 = 'Shape';
    /**
     * Everything the stroke outline is built from beyond the contours and the
     * colour. The held buffer is only reused while this is unchanged, so a dash,
     * a cap or a join toggled on an existing item redraws: none of them moves a
     * vertex of the fill, and a cap or a join does not even change the segment
     * count the hold falls back on.
     */
    function outlineSignature(item) {
        return [
            item.strokeDash?.join(' ') ?? '',
            item.strokeDashOffset ?? 0,
            item.strokeCap ?? '',
            item.strokeJoin ?? '',
            item.strokeMiterLimit ?? '',
        ].join('|');
    }
    function getResources$2(device, ctx, vb) {
        return getMarkResources(ctx, 'shape', device, vb, () => ({
            ...fillResources(ctx, device, vb, drawName$2, `${drawName$2}Stroke`),
            outlines: new OutlineBuffer(),
            outlineState: new WeakMap(),
            cache: geometryCache(),
        }));
    }
    function draw$2(device, ctx, scene, vb) {
        const items = markItems(scene);
        if (items.length === 0) {
            return;
        }
        const res = getResources$2(device, ctx, vb);
        const uniformBuffer = res.bufferManager.createUniformBuffer();
        const useCache = ctx._renderer.wgOptions.cacheShapes ?? true;
        const fillTarget = targetOf(ctx, device, drawName$2, res, res.bufferManager, uniformBuffer);
        // Solid fills share one draw in paint order, and a gradient fill or an outline
        // drawn on its own closes the run.
        const run = new DrawRun(ctx._opaqueBackdrop, (chunks, blend) => {
            const data = joinChunks(chunks);
            if (data) {
                enqueueFill(fillTarget, data, null, blend);
            }
        });
        const outlineTarget = targetOf(ctx, device, res.outline.name, res.outline, res.bufferManager, uniformBuffer);
        // Outlines draw after the fills, from one buffer the scene keeps. A sub pixel
        // stroke on a triangulated ribbon takes its coverage from MSAA, which can
        // only express quarter steps, so a 0.2 px country border came out patchy.
        const pending = [];
        // An outline only has to be rebuilt when something it is drawn from moved or
        // changed colour, which on a stroked choropleth is the difference between
        // rewriting a few hundred thousand segments a frame and rewriting none.
        let outlinesHeld = true;
        for (const item of items) {
            const blend = blendKey(item.blend);
            const fill = paintOf(item.fill, item.opacity, item.fillOpacity, item.bounds);
            const stroke = paintOf(item.stroke, item.opacity, item.strokeOpacity, item.bounds);
            let shapeGeom = null;
            const geom = () => (shapeGeom ??= shape$1(ctx, item));
            const [fillData, lines, unchanged, kept] = createGeometryData(ctx, res, item, fill, stroke, useCache, geom);
            if (fillData.length > 0 && fill.ramp) {
                run.flush();
                enqueueFill(fillTarget, fillData, fill.ramp, blend);
            }
            else {
                run.add(fillData, blend);
            }
            // One draw per item, see needsBackdrop.
            const layered = needsBackdrop(blend, ctx._opaqueBackdrop);
            if (stroke.ramp || layered) {
                // A ramp is per item, so this one cannot join the held buffer below: its
                // own draw carries its own bind group. Neither can a layered blend, since
                // the held buffer draws after every fill where canvas strokes each item
                // before it fills the next.
                const own = stroke.colour[3] > 0 ? outlineInstances(item, lines, stroke.colour) : null;
                if (own) {
                    run.flush();
                    enqueueOutline(outlineTarget, own, stroke.ramp, blend);
                }
                if (kept) {
                    kept.count = undefined;
                }
            }
            else {
                outlinesHeld &&= unchanged && kept?.count !== undefined;
                pending.push({ item, lines, blend, kept });
            }
        }
        run.flush();
        const state = res.outlineState.get(scene) ?? { buffer: null, capacity: 0, length: -1 };
        res.outlineState.set(scene, state);
        const heldCount = outlinesHeld ? pending.reduce((n, { kept }) => n + (kept?.count ?? 0), 0) : -1;
        const heldOutline = heldCount * SEGMENT_STRIDE === state.length && state.buffer !== null;
        // Which stretch of the buffer carries which blend, so one buffer can still
        // serve a mark whose items do not agree on it. A held buffer is not written,
        // so its stretches come from the counts the items wrote last time.
        const outlines = res.outlines;
        outlines.length = 0;
        const outlineRuns = [];
        let segments = 0;
        for (const { item, lines, blend, kept } of pending) {
            let count = kept?.count ?? 0;
            if (!heldOutline) {
                const before = outlines.length;
                pushOutline(outlines, item, lines);
                count = (outlines.length - before) / SEGMENT_STRIDE;
                if (kept) {
                    kept.count = count;
                }
            }
            const last = outlineRuns[outlineRuns.length - 1];
            if (last && last.blend === blend) {
                last.count += count;
            }
            else if (count > 0) {
                outlineRuns.push({ blend, start: segments, count });
            }
            segments += count;
        }
        state.length = segments * SEGMENT_STRIDE;
        if (segments > 0) {
            const buffer = outlineBuffer(device, state, outlines, heldOutline);
            for (const run of outlineRuns) {
                const pipeline = res.outline.pipelineFor(run.blend);
                ctx._renderQueue.enqueue({
                    pipeline,
                    drawCounts: [6, run.count, 0, run.start],
                    vertexBuffers: [buffer],
                    bindGroups: [uniformBindGroup(ctx, device, `${drawName$2}Stroke`, pipeline, uniformBuffer)],
                    clip: ctx._clip,
                });
            }
        }
    }
    /**
     * Appends one item's outline, contour by contour, as segment instances. A dash
     * splits each contour into its drawn runs first, which is the only way a shape
     * can carry one: its stroke is an extruded ribbon everywhere else.
     */
    function pushOutline(out, item, lines) {
        const width = item.strokeWidth ?? 1;
        const color = Color.from(item.stroke, item.opacity, item.strokeOpacity);
        const runs = outlineRuns(item, lines);
        if (!runs || color[3] <= 0) {
            return;
        }
        const needed = segmentCount(runs) * SEGMENT_STRIDE;
        out.length = writeSegments(out.reserve(needed), out.length, runs, color, width, strokeEnds(item));
    }
    /**
     * The drawn runs of one item's outline, or null when it has none.
     *
     * Placed the way the fill is: vega translates to the item and rotates before it
     * calls the generator and strokes the path it filled, so an outline walked off
     * the raw contours was drawn at the origin whatever the item's x, y and angle
     * said. A geo shape has nothing to place, so a choropleth's contours are not
     * copied.
     */
    function outlineRuns(item, lines) {
        if (!item.stroke || (item.strokeWidth ?? 1) <= 0) {
            return null;
        }
        const runs = strokeRuns(lines, item, { dx: item.x || 0, dy: item.y || 0, angle: itemTurn(item) });
        return segmentCount(runs) === 0 ? null : runs;
    }
    /** The same runs as their own instance buffer, for an outline drawn on its own. */
    function outlineInstances(item, lines, color) {
        const runs = outlineRuns(item, lines);
        if (!runs) {
            return null;
        }
        return segmentInstances(runs, color, item.strokeWidth ?? 1, strokeEnds(item));
    }
    /**
     * The scene's own outline buffer, rewritten only when the outline changed.
     * writeBuffer is ordered on the queue, so a rewrite lands after the previous
     * frame's draws have read it.
     */
    function outlineBuffer(device, state, outlines, held) {
        if (state.buffer && held) {
            return state.buffer;
        }
        const bytes = new Uint8Array(outlines.data.buffer, 0, outlines.length * 4);
        if (!state.buffer || state.capacity < bytes.byteLength) {
            let capacity = Math.max(bytes.byteLength, 4096);
            if (state.buffer) {
                capacity = Math.max(capacity, state.capacity * 2);
            }
            state.buffer = device.createBuffer({
                label: `${drawName$2} Outline`,
                size: capacity,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            });
            state.capacity = capacity;
        }
        device.queue.writeBuffer(state.buffer, 0, bytes, 0, bytes.byteLength);
        return state.buffer;
    }
    /**
     * A float buffer the shape mark keeps between frames. Outlines run to hundreds
     * of thousands of segments on a stroked choropleth, so growing a plain array a
     * number at a time and converting it back cost more than everything else the
     * mark does.
     */
    class OutlineBuffer {
        data = new Float32Array(0);
        length = 0;
        /** Room for `n` more floats, returning the buffer to write into. */
        reserve(n) {
            if (this.length + n > this.data.length) {
                let size = Math.max(4096, this.data.length * 2);
                while (size < this.length + n) {
                    size *= 2;
                }
                const grown = new Float32Array(size);
                grown.set(this.data.subarray(0, this.length));
                this.data = grown;
            }
            return this.data;
        }
    }
    function createGeometryData(ctx, res, item, fillPaint, strokePaint, useCache, geom) {
        const fill = fillPaint.colour;
        const stroke = strokePaint.colour;
        const strokeIsGradient = strokePaint.ramp !== null;
        const outline = outlineSignature(item);
        // Keyed by the item itself, which vega keeps across re-renders of the same
        // tuple. A datum id is not unique: a county split across several polygons is
        // several items sharing one id, and they would then share one entry.
        const entry = useCache ? cachedFill(res.cache, item, item, fill) : undefined;
        if (entry) {
            const kept = entry.extra;
            const unchanged = outline === kept.outline && strokeIsGradient === kept.strokeIsGradient && sameColor(stroke, kept.stroke);
            kept.outline = outline;
            kept.stroke = stroke;
            kept.strokeIsGradient = strokeIsGradient;
            return [entry.data, kept.lines, unchanged, kept];
        }
        // the outline draws as segments, so the triangulation only builds the fill
        const shapeGeom = geom();
        // vega translates to the item and rotates before it calls the generator, so
        // a shape given an x, y or angle is drawn there rather than at the origin
        const geometry = geometryForItem(ctx, { ...item, stroke: undefined }, shapeGeom, false, item.x || 0, item.y || 0, {
            angle: itemTurn(item),
            scaleX: 1,
            scaleY: 1,
        });
        const data = vertexData(geometry.fillTriangles, geometry.fillCount, fill);
        if (!useCache) {
            return [data, shapeGeom.lines, false, null];
        }
        const kept = { lines: shapeGeom.lines, outline, stroke, strokeIsGradient };
        cacheFill(res.cache, item, item, fill, data, kept);
        return [data, shapeGeom.lines, false, kept];
    }
    var shape = { draw: draw$2 };

    const drawName$1 = 'Symbol';
    // Bounds the triangulated-shape cache. `size` is continuous, so a size-encoded
    // chart would otherwise mint a GPU buffer per distinct size, forever.
    const MAX_SHAPE_CACHE = 256;
    function getResources$1(device, ctx, vb) {
        return getMarkResources(ctx, 'symbol', device, vb, () => {
            const bufferManager = new BufferManager(device, drawName$1);
            const circleVertexManager = new VertexBufferManager(['float32x2'], // position
            // center, radius, fill color, stroke color, stroke width
            ['float32x2', 'float32', 'float32x4', 'float32x4', 'float32']);
            const circlePipelineFor = blendPipelines(ctx, device, drawName$1, drawName$1, circleVertexManager);
            const shapeVertexManager = new VertexBufferManager(['float32x2'], // geometry position (centered on origin)
            ['float32x2', 'float32x4', 'float32']);
            const shapePipelineFor = blendPipelines(ctx, device, `${drawName$1}Shape`, 'SymbolShape', shapeVertexManager);
            const sdfVertexManager = new VertexBufferManager(['float32x2'], // unit quad position
            // center, size, fill color, stroke color, stroke width, angle
            ['float32x2', 'float32', 'float32x4', 'float32x4', 'float32', 'float32']);
            // One square for both the circle and the sdf quads: nothing culls, so the
            // winding the two used to differ by was never observable.
            const quadGeometry = bufferManager.createGeometryBuffer(Float32Array.from([-1, -1, -1, 1, 1, -1, 1, -1, -1, 1, 1, 1]), true);
            const colorVertexManager = new VertexBufferManager(['float32x2', 'float32x4']); // position, color
            const solidPipelineFor = blendPipelines(ctx, device, `${drawName$1}Solid`, 'SolidFill', colorVertexManager);
            // a dashed outline draws as segments, the way a dashed line and a dashed
            // group border already do
            const outline = outlinePipelines(ctx, device, `${drawName$1}Dash`);
            // a gradient fill under a blend needs its own pipeline too
            const gradientPipelineFor = blendPipelines(ctx, device, `${drawName$1}Gradient`, 'GradientFill', colorVertexManager);
            return {
                device,
                bufferManager,
                circlePipelineFor,
                shapePipelineFor,
                // a draw queued this frame may still read an evicted one, so the pool frees it later
                shapeCache: new LruMap(MAX_SHAPE_CACHE, ({ fill, stroke }) => {
                    if (fill) {
                        bufferPool(device).hold(fill);
                    }
                    if (stroke) {
                        bufferPool(device).hold(stroke);
                    }
                }),
                outline,
                sdfVertexManager,
                quadGeometry,
                colorVertexManager,
                solidPipelineFor,
                gradientPipelineFor,
            };
        });
    }
    function draw$1(device, ctx, scene, vb) {
        const items = markItems(scene);
        if (items.length === 0) {
            return;
        }
        const res = getResources$1(device, ctx, vb);
        const uniformBuffer = res.bufferManager.createUniformBuffer();
        let circleBindGroup = null;
        // Built for the first dashed or gradient symbol, and kept for the rest.
        let outline = null;
        let gradient = null;
        const outlineTarget = () => (outline ??= targetOf(ctx, device, res.outline.name, res.outline, res.bufferManager, res.bufferManager.sharedUniformBuffer()));
        const gradientTarget = () => (gradient ??= targetOf(ctx, device, `${drawName$1}Fill`, { pipelineFor: res.solidPipelineFor, gradientPipelineFor: res.gradientPipelineFor }, res.bufferManager, res.bufferManager.sharedUniformBuffer()));
        const run = new DrawRun(ctx._opaqueBackdrop, (symbols, runBlend) => {
            const shape = symbolShape(symbols[0]);
            if (shape === 'circle') {
                const circlePipeline = res.circlePipelineFor(runBlend);
                // A bind group belongs to the layout it was made from, so a mark whose
                // items carry different blends cannot hold one across the change.
                if (circleBindGroup === null || circleBindGroup.pipeline !== circlePipeline) {
                    circleBindGroup = {
                        group: uniformBindGroup(ctx, device, drawName$1, circlePipeline, uniformBuffer),
                        pipeline: circlePipeline,
                    };
                }
                const instanceBuffer = res.bufferManager.createInstanceBuffer(quadInstances(symbols, true));
                ctx._renderQueue.enqueue({
                    pipeline: circlePipeline,
                    drawCounts: [6, symbols.length],
                    vertexBuffers: [res.quadGeometry, instanceBuffer],
                    bindGroups: [circleBindGroup.group],
                    clip: ctx._clip,
                });
            }
            else if (hasSdf(shape)) {
                const pipeline = markPipeline(ctx, device, `${drawName$1}Sdf ${shape}`, `SymbolSdf:${shape}`, res.sdfVertexManager, undefined, runBlend);
                const instanceBuffer = res.bufferManager.createInstanceBuffer(quadInstances(symbols, false));
                ctx._renderQueue.enqueue({
                    pipeline,
                    drawCounts: [6, symbols.length],
                    vertexBuffers: [res.quadGeometry, instanceBuffer],
                    bindGroups: [uniformBindGroup(ctx, device, `${drawName$1}Sdf`, pipeline, uniformBuffer)],
                    clip: ctx._clip,
                });
            }
            else {
                drawShapeGroup(device, ctx, res, uniformBuffer, runBlend, symbols);
            }
        });
        for (const item of items) {
            const blend = blendKey(item.blend);
            // A dashed outline cannot come from a shader that draws the whole ring, so
            // the shape is walked and dashed. The fill still goes through the normal
            // run, with the stroke taken off it so it is not drawn solid underneath.
            const dash = dashPatternOf(item);
            // A ramp cannot come out of the distance function either, so a gradient
            // stroke takes the same walk a dash does.
            const strokeRamp = rampOf(item.stroke, item.bounds);
            const fillRamp = rampOf(item.fill, item.bounds);
            if (dash || strokeRamp) {
                run.flush();
                // The fill first, which is the order canvas paints them in. Drawn after
                // the dash it covers the inner half of every run.
                const filled = { ...item, stroke: undefined };
                if (fillRamp) {
                    drawGradientSymbol(ctx, gradientTarget(), filled, fillRamp, blend);
                }
                else if (item.fill) {
                    run.add(filled, blend, runKey(filled));
                    run.flush();
                }
                drawSymbolOutline(ctx, outlineTarget(), item, blend, dash, strokeRamp);
                continue;
            }
            // Gradient fills need the gradient pipeline and are drawn one at a time.
            if (fillRamp) {
                run.flush();
                drawGradientSymbol(ctx, gradientTarget(), item, fillRamp, blend);
                continue;
            }
            run.add(item, blend, runKey(item));
        }
        run.flush();
    }
    /** vega's defaults, which a symbol that sets neither is drawn with. */
    const symbolShape = (item) => item.shape || 'circle';
    const symbolSize = (item) => item.size ?? 64;
    /**
     * What a symbol shares a draw on, beside its blend. A circle and a shape with a
     * distance function are one instanced quad each, so a run can hold any mix of
     * sizes, stroke widths and angles. A triangulated shape shares its geometry
     * buffer, so those have to agree as well.
     */
    function runKey(item) {
        const shape = symbolShape(item);
        return shape === 'circle' || hasSdf(shape) ? shape : `${shape}|${symbolSize(item)}|${strokeWidthOf(item)}`;
    }
    /** The width a triangulated symbol's shared geometry is built at. */
    function strokeWidthOf(item) {
        return item.stroke ? (item.strokeWidth ?? 1) : 0;
    }
    /**
     * A symbol's outline, dashed. Its shape is a path like any other, so the same
     * contour walk serves. Scale is already baked in by `size`, so only the item's
     * rotation and position apply. A line legend's swatch is a `symbol` with
     * `shape: 'stroke'` and a dash, which is where this shows.
     */
    function drawSymbolOutline(ctx, target, item, blend, pattern, ramp) {
        if (!item.stroke) {
            return;
        }
        // A dash is measured along the contour, so it takes the coarse one whatever
        // the ratio. A solid outline is only drawn on it and takes the fine one.
        const geom = symbol$1(ctx, symbolShape(item), symbolSize(item), pattern ? DASH_FLATNESS : undefined);
        const data = segmentInstances(strokeRuns(geom.lines, item, { dx: item.x || 0, dy: item.y || 0, angle: itemTurn(item) }), paintColour(item.stroke, item.opacity, item.strokeOpacity, ramp), item.strokeWidth ?? 1, strokeEnds(item));
        if (!data) {
            return;
        }
        enqueueOutline(target, data, ramp, blend);
    }
    function drawShapeGroup(device, ctx, res, uniformBuffer, blend, group) {
        const first = group[0];
        const shape = symbolShape(first);
        const size = symbolSize(first);
        const key = `${shape}|${size}|${strokeWidthOf(first)}`;
        // A shape with no distance function is triangulated, and this used to draw it
        // through the one pipeline whatever the item asked for, so it never blended.
        const pipeline = res.shapePipelineFor(blend);
        const bindGroup = uniformBindGroup(ctx, device, `${drawName$1}Shape`, pipeline, uniformBuffer);
        const geom = getShapeGeometry(res, ctx, key, shape, size, first.strokeWidth ?? 1);
        if (geom.fill && geom.fillCount > 0) {
            const instances = instanceData(group, false);
            if (instances.count > 0) {
                ctx._renderQueue.enqueue({
                    pipeline,
                    drawCounts: [geom.fillCount, instances.count],
                    vertexBuffers: [geom.fill, res.bufferManager.createInstanceBuffer(instances.data)],
                    bindGroups: [bindGroup],
                    clip: ctx._clip,
                });
            }
        }
        if (geom.stroke && geom.strokeCount > 0) {
            const instances = instanceData(group, true);
            if (instances.count > 0) {
                ctx._renderQueue.enqueue({
                    pipeline,
                    drawCounts: [geom.strokeCount, instances.count],
                    vertexBuffers: [geom.stroke, res.bufferManager.createInstanceBuffer(instances.data)],
                    bindGroups: [bindGroup],
                    clip: ctx._clip,
                });
            }
        }
    }
    /** Draws one gradient-filled symbol: gradient fill + solid stroke, triangulated. */
    function drawGradientSymbol(ctx, target, item, ramp, blend) {
        const pathGeom = symbol$1(ctx, symbolShape(item), symbolSize(item));
        const geometry = geometryForItem(ctx, item, pathGeom, false, item.x || 0, item.y || 0, {
            angle: itemTurn(item),
            scaleX: 1,
            scaleY: 1,
        });
        const fillData = vertexData(geometry.fillTriangles, geometry.fillCount, paintColour(item.fill, item.opacity, item.fillOpacity, ramp));
        const strokeData = vertexData(geometry.strokeTriangles, geometry.strokeCount, Color.from(item.stroke, item.opacity, item.strokeOpacity));
        if (fillData.length > 0) {
            enqueueFill(target, fillData, ramp, blend);
        }
        if (strokeData.length > 0) {
            enqueueFill(target, strokeData, null, blend);
        }
    }
    /** Floats per triangulated shape instance: centre, colour, angle. */
    const SHAPE_STRIDE = 7;
    /** Instance rows for the items of a run that carry the paint being drawn. */
    function instanceData(group, stroke) {
        const out = instanceScratch(group.length * SHAPE_STRIDE);
        let count = 0;
        for (const item of group) {
            const paint = stroke ? item.stroke : item.fill;
            if (!paint || paint === 'transparent') {
                continue;
            }
            const base = count * SHAPE_STRIDE;
            out[base] = item.x || 0;
            out[base + 1] = item.y || 0;
            Color.write(out, base + 2, paint, item.opacity, stroke ? item.strokeOpacity : item.fillOpacity);
            out[base + 6] = itemTurn(item);
            count++;
        }
        return { data: out.subarray(0, count * SHAPE_STRIDE), count };
    }
    function getShapeGeometry(res, ctx, key, shape, size, strokeWidth) {
        const cached = res.shapeCache.get(key);
        if (cached) {
            return cached;
        }
        const pathGeom = symbol$1(ctx, shape, size);
        // Origin-centered fill + stroke triangles (dx/dy default to 0).
        const geometry = geometryForItem(ctx, { fill: '#000', stroke: '#000', strokeWidth, opacity: 1 }, pathGeom);
        // Held across frames, so these stay out of the frame pool. A pooled buffer is
        // destroyed two frames after the one that made it, and the cache went on
        // handing out the destroyed one: `[Buffer "Symbol Geometry Buffer"] used in
        // submit while destroyed` on every frame after the third.
        const entry = {
            fill: geometry.fillCount > 0
                ? res.bufferManager.createGeometryBuffer(geometry.fillTriangles.subarray(0, geometry.fillCount * 2), true)
                : null,
            fillCount: geometry.fillCount,
            stroke: geometry.strokeCount > 0
                ? res.bufferManager.createGeometryBuffer(geometry.strokeTriangles.subarray(0, geometry.strokeCount * 2), true)
                : null,
            strokeCount: geometry.strokeCount,
        };
        res.shapeCache.set(key, entry);
        return entry;
    }
    /** Floats per circle instance: centre, radius, fill, stroke, width. */
    const CIRCLE_STRIDE = 12;
    /** Floats per sdf instance: centre, side, fill, stroke, width, angle. */
    const SDF_STRIDE = 13;
    /**
     * Instance rows for the symbols drawn as one quad each: a circle, sized by its
     * radius, or a shape with a distance function, sized by its side and turned.
     */
    function quadInstances(items, circle) {
        const stride = circle ? CIRCLE_STRIDE : SDF_STRIDE;
        const result = instanceScratch(items.length * stride);
        for (let i = 0, len = items.length; i < len; i++) {
            const item = items[i];
            const { fill, stroke, strokeWidth = 1, opacity = 1, fillOpacity = 1, strokeOpacity = 1 } = item;
            const base = i * stride;
            const side = Math.sqrt(symbolSize(item));
            result[base] = item.x || 0;
            result[base + 1] = item.y || 0;
            result[base + 2] = circle ? side / 2 : side;
            Color.write(result, base + 3, fill, opacity, fillOpacity);
            Color.write(result, base + 7, stroke, opacity, strokeOpacity);
            result[base + 11] = stroke ? strokeWidth : 0;
            if (!circle) {
                result[base + 12] = itemTurn(item);
            }
        }
        return result;
    }
    var symbol = { draw: draw$1 };

    /** Transparent gap between packed labels, so filtering cannot reach a neighbour. */
    const PAD = 1;
    const INITIAL_SIZE = 512;
    const MAX_SIZE = 2048;
    /**
     * Packs the labels of a frame into one canvas and uploads them in a single
     * copy. `copyExternalImageToTexture` costs about 1.2 ms whenever its source
     * canvas changed since the last copy, regardless of the region size, so a
     * texture per label made a rotating radial tree spend 250 ms a frame in the
     * driver.
     *
     * Slots survive across frames. Growing or clearing mints a new texture, and the
     * one it replaces stays alive until the frame is submitted, so only the batch
     * currently being packed (which shares one bind group) has to be protected.
     */
    class TextAtlas {
        _device;
        _release;
        _max;
        _canvas;
        _c2d;
        _slots = new Map();
        _texture;
        _size = 0;
        _shelfY = 0;
        _shelfHeight = 0;
        _cursorX = 0;
        _dirty = null;
        _spilled = false;
        _batchArea = 0;
        _lastBatchArea = 0;
        /** `release` takes a texture the atlas replaced, which a queued draw may still hold. */
        constructor(_device, _release) {
            this._device = _device;
            this._release = _release;
            this._max = Math.min(MAX_SIZE, _device.limits.maxTextureDimension2D);
            this._canvas = document.createElement('canvas');
            this._c2d = this._canvas.getContext('2d', { willReadFrequently: true });
            this._reset(Math.min(INITIAL_SIZE, this._max));
        }
        get context() {
            return this._c2d;
        }
        get texture() {
            return this._texture;
        }
        get size() {
            return this._size;
        }
        /**
         * Starts a batch of lookups that will share one bind group, growing or
         * clearing the atlas first if the last batch of this size would not fit in
         * what is left. Nothing else replaces the texture, so a batch always packs
         * into the one it read.
         */
        begin() {
            this._lastBatchArea = this._batchArea;
            this._batchArea = 0;
            const free = Math.max(0, this._size - this._shelfY - this._shelfHeight) * this._size;
            if (!this._spilled && free >= this._lastBatchArea) {
                return;
            }
            this._reset(this._size < this._max ? Math.min(this._size * 2, this._max) : this._size);
        }
        /** Slot for a label already packed. */
        find(key) {
            return this._slots.get(key);
        }
        /**
         * Reserves space for a label. Returns null when it does not fit, and the
         * caller falls back to a texture of its own.
         */
        alloc(key, metrics) {
            const { physWidth: w, physHeight: h } = metrics;
            const placed = this._place(w, h);
            if (!placed) {
                this._spilled = true;
                return null;
            }
            this._batchArea += w * h;
            const slot = { ...metrics, x: placed[0], y: placed[1] };
            this._slots.set(key, slot);
            this._markDirty(slot.x, slot.y, slot.x + w, slot.y + h);
            return slot;
        }
        /** Uploads whatever was drawn since the last flush. */
        flush() {
            const dirty = this._dirty;
            if (!dirty) {
                return;
            }
            this._dirty = null;
            const [x0, y0, x1, y1] = dirty;
            uploadImage(this._device, this._canvas, this._texture, x1 - x0, y1 - y0, [x0, y0]);
        }
        _place(w, h) {
            if (w + PAD > this._size || h + PAD > this._size) {
                return null;
            }
            if (this._cursorX + w + PAD > this._size) {
                this._shelfY += this._shelfHeight + PAD;
                this._shelfHeight = 0;
                this._cursorX = 0;
            }
            if (this._shelfY + h + PAD > this._size) {
                return null;
            }
            const x = this._cursorX;
            const y = this._shelfY;
            this._cursorX += w + PAD;
            this._shelfHeight = Math.max(this._shelfHeight, h);
            return [x, y];
        }
        _reset(size) {
            const first = this._size === 0;
            if (size !== this._size) {
                this._size = size;
                this._canvas.width = size;
                this._canvas.height = size;
            }
            else {
                this._c2d.setTransform(1, 0, 0, 1, 0, 0);
                this._c2d.clearRect(0, 0, size, size);
            }
            if (!first) {
                this._release(this._texture);
            }
            this._slots.clear();
            this._shelfY = 0;
            this._shelfHeight = 0;
            this._cursorX = 0;
            this._dirty = null;
            this._spilled = false;
            this._texture = imageTexture(this._device, 'Text Atlas', size, size);
        }
        _markDirty(x0, y0, x1, y1) {
            if (!this._dirty) {
                this._dirty = [x0, y0, x1, y1];
                return;
            }
            this._dirty[0] = Math.min(this._dirty[0], x0);
            this._dirty[1] = Math.min(this._dirty[1], y0);
            this._dirty[2] = Math.max(this._dirty[2], x1);
            this._dirty[3] = Math.max(this._dirty[3], y1);
        }
    }

    const HALF_PI = Math.PI / 2;
    const textMark = vegaScenegraph.Marks.text;
    /**
     * Sub-pixel phases are quantized to this many steps per device pixel so the
     * glyph cache does not grow unbounded when the same string is drawn at many
     * fractional positions. At 8 steps a label could land in a different one of
     * skia's own subpixel buckets than canvas picked, which flips a whole stem
     * pixel: scales-discretize and panzoom were both 255 off on one. 64 costs
     * nothing on a static scene, since each label still has one phase, and only
     * churns the cache faster while text is moving.
     */
    const PHASE_STEPS = 64;
    /** `v` snapped to the PHASE_STEPS grid, so the cache cannot grow unbounded. */
    function quantize(v) {
        return Math.round(v * PHASE_STEPS) / PHASE_STEPS;
    }
    /** The point text is positioned around (x/y, offset by radius/theta). */
    function textAnchor(item) {
        let x = item.x || 0;
        let y = item.y || 0;
        const r = item.radius || 0;
        if (r) {
            const t = (item.theta || 0) - HALF_PI;
            x += r * Math.cos(t);
            y += r * Math.sin(t);
        }
        return [x, y];
    }
    /**
     * A paint as a key. A gradient is an object and every object stringifies the
     * same way, so joining one straight into the key made every gradient on text
     * collide: two labels with different gradients shared a raster, and the second
     * took the first one's colours.
     */
    function paintKey(paint) {
        return paint !== null && typeof paint === 'object' ? JSON.stringify(paint) : String(paint);
    }
    /**
     * Cache key over everything that affects the rasterized pixels (not opacity,
     * which the shader applies). `radius`/`theta` are not included, because they
     * only move the anchor in scene space and cancel out of the anchor-relative
     * offset. `angle` is, and is zero for a glyph the quad will turn instead.
     *
     * A label is rasterized by vega's own canvas text mark, so everything its
     * stroke helper sets belongs here: the dash, its offset, the cap, the join and
     * the miter limit all change the glyph pixels, and the join and the limit
     * change the cell size `strokeReach` asks for as well.
     */
    function textCacheKey(item) {
        // vega draws an array as one line per entry and a string as one line, so
        // an array and its concatenation are two different pictures. Joined with
        // nothing they were one key and the second label reused the first raster.
        const text = Array.isArray(item.text) ? JSON.stringify(item.text) : String(item.text ?? '');
        return [
            text,
            item.font,
            item.fontSize,
            item.fontStyle,
            item.fontVariant,
            item.fontWeight,
            item.align,
            item.baseline,
            item.angle,
            item.dx,
            item.dy,
            paintKey(item.fill),
            item.fillOpacity,
            paintKey(item.stroke),
            item.strokeOpacity,
            item.strokeWidth,
            item.strokeCap,
            item.strokeJoin,
            item.strokeMiterLimit,
            String(item.strokeDash),
            item.strokeDashOffset,
            item.lineBreak,
            item.lineHeight,
            item.limit,
            item.ellipsis,
            item.dir,
        ].join('|');
    }
    /**
     * How far a stroke reaches past the glyph outline, in whole device pixels.
     *
     * A miter runs out to `miterLimit * width / 2` at a sharp enough corner, which
     * is where canvas clamps it. Any other join stays inside half the width.
     */
    function glyphStrokePad(raster, dpi) {
        if (!raster.stroke) {
            return 0;
        }
        const half = (raster.strokeWidth ?? 1) / 2;
        const { style, miterLimit } = joinStyleOf(raster);
        return Math.ceil(half * (style === 'miter' ? Math.max(miterLimit, 1) : 1) * dpi);
    }
    /**
     * Size of `raster`'s rasterization and where its anchor sits inside it. The
     * anchor offset is picked so that turning the quad about the anchor puts the
     * glyph's top-left corner on a whole device pixel, which for a quarter turn
     * maps every texel onto exactly one pixel, and for no turn at all reproduces
     * what the canvas renderer rasterizes.
     */
    function glyphMetrics(ctx, raster, vb, turn) {
        const dpi = ctx._uniforms.dpi || 1;
        const b = textMark.bound(new vegaScenegraph.Bounds(), raster, 0);
        const [ax, ay] = textAnchor(raster);
        // vega's text bound is the fill glyph box, since textMetrics reports an
        // advance and a height and neither knows about a stroke, so a cell sized
        // from it cuts the stroke off. Half the width is not the reach either: a
        // glyph corner under a miter join carries out to miterLimit * width / 2,
        // which is the bound canvas itself clamps to and the one geometryForItem
        // pads by. Whole device pixels, so the anchor rounds the way it did.
        const strokePad = glyphStrokePad(raster, dpi);
        // At least 1px clearance so antialiased edges are never clipped.
        const padLeft = Math.ceil(Math.max(0, (ax - b.x1) * dpi)) + 1 + strokePad;
        const padTop = Math.ceil(Math.max(0, (ay - b.y1) * dpi)) + 1 + strokePad;
        const [anchorTexX, anchorTexY] = anchorOffset((ax - vb.x1) * dpi, (ay - vb.y1) * dpi, padLeft, padTop, turn);
        const physWidth = Math.ceil(anchorTexX + (b.x2 - ax) * dpi) + 1 + strokePad;
        const physHeight = Math.ceil(anchorTexY + (b.y2 - ay) * dpi) + 1 + strokePad;
        if (physWidth <= 0 || physHeight <= 0) {
            return null;
        }
        return { physWidth, physHeight, anchorTexX, anchorTexY };
    }
    const NO_DRIFT = [0, 0];
    /** How near a half pixel a baseline has to be for canvas to disagree with us. */
    const TIE_WINDOW = 1e-3;
    /**
     * Whole device pixels the canvas renderer would put this label away from where
     * its own coordinates say, which is 0 unless its baseline sits on a half pixel.
     *
     * Two things move it, and both are canvas arithmetic rather than geometry. Its
     * matrix has drifted (see util/canvasDrift.ts), and it is a float32 matrix, so
     * a baseline our double puts at 157.49999999999994 is exactly 157.5 to it and
     * rounds the other way. Both are reproduced by computing the baseline the way
     * canvas does and comparing which whole pixel each lands on.
     *
     * The shift is kept apart from the sub-pixel phase on purpose. It is the only
     * thing that can move a label, and folding the difference into the phase
     * instead re-rasterizes labels it cannot move: a re-rasterization at a
     * hair-different phase can still flip a hinted stem, and every axis label in
     * `scatter-brush-panzoom` went to worst channel 255 that way. Rotated labels
     * are left exact, since the snap this crosses is the upright one.
     */
    function driftShift(ctx, item, vb, turn, translation) {
        if (turn !== NO_TURN || translation === undefined) {
            return NO_DRIFT;
        }
        const dpi = ctx._uniforms.dpi || 1;
        const local = textAnchor(item)[1];
        const ours = (local - vb.y1) * dpi;
        // Only a baseline on the half pixel has anything to decide, and holding the
        // rest to exactly what they were is what keeps this from touching labels it
        // cannot move. The window covers the drift and the float32 step both.
        if (Math.abs(ours - Math.floor(ours) - 0.5) > TIE_WINDOW) {
            return NO_DRIFT;
        }
        // Both sides narrow to float32 before the snap, because that is what the
        // quad does on its way to the gpu. Narrowing one and not the other is what
        // left `Wicker Park` behind: its baseline is 146.49999999999994, which reads
        // as 146 in double and as exactly 146.5, so 147, once narrowed. The model
        // compared 146 against a drifted 146 and moved nothing while the label sat a
        // row below canvas. Narrowed the same way they agree when there is no drift
        // and differ by the row when there is.
        const theirs = translation + local * dpi;
        return [0, Math.round(Math.fround(theirs)) - Math.round(Math.fround(ours))];
    }
    const NO_TURN = [1, 0];
    /** Cosine and sine of an item's angle, which vega stores in degrees. */
    function turnOf(item) {
        const a = itemTurn(item);
        return a === 0 ? NO_TURN : [Math.cos(a), Math.sin(a)];
    }
    /**
     * Anchor offset inside the texture, in device pixels. The rotated corner sits
     * at `p - R * anchor`, so rounding that to a whole pixel and mapping back
     * through the inverse rotation gives the offset that lands it there.
     *
     * An upright label keeps its vertical phase exactly. The browser positions a
     * glyph sub-pixel across the baseline and snaps it to a whole pixel along it,
     * so a phase quantized onto a grid can land the other side of that snap from
     * where canvas put it, which moves the whole label a pixel. The snapping is
     * also why the finer key costs nothing: every phase on one side of it
     * rasterizes to the same glyph.
     */
    function anchorOffset(px, py, padLeft, padTop, [c, s]) {
        const nx = Math.round(px - (c * padLeft - s * padTop));
        const ny = Math.round(py - (s * padLeft + c * padTop));
        const dx = px - nx;
        const dy = py - ny;
        if (s === 0 && c === 1) {
            return [quantize(dx), dy];
        }
        return [quantize(c * dx + s * dy), quantize(-s * dx + c * dy)];
    }
    /**
     * The item with its rotation dropped, for a quad that will turn instead.
     *
     * Rasterizing the rotation in matches canvas at any angle, but every rotated
     * label a frame moves then has to be rasterized and read back out of a 2D
     * canvas, about 0.15 ms each: a radial tree spent 32 ms a frame there.
     */
    function upright(item) {
        return { ...item, angle: 0 };
    }
    /**
     * Draws the label with vega-scenegraph's own canvas text mark, so the pixels
     * match the canvas renderer exactly, with its top-left at (originX, originY).
     */
    function drawGlyph(c2d, dpi, raster, m, originX, originY) {
        const [ax, ay] = textAnchor(raster);
        c2d.setTransform(dpi, 0, 0, dpi, originX + m.anchorTexX - dpi * ax, originY + m.anchorTexY - dpi * ay);
        // the blend is the composite's, and vega would set it on the atlas context
        textMark.draw(c2d, { items: [{ ...raster, opacity: 1, blend: undefined }] }, null);
    }
    /**
     * A label too large for the atlas, rasterized into a texture of its own.
     *
     * Premultiplied, for the same reason as the image mark: converting a glyph's
     * antialiased edge to straight alpha turns its transparent side black and
     * filtering then darkens the edge. The shader divides the alpha back out.
     */
    function rasterizeText(device, canvas, c2d, dpi, raster, m) {
        // Grow-only. Resizing a canvas recreates its backing store, which invalidates
        // the external image reference the GPU copy takes (an OperationError on Linux
        // Dawn). The glyph is drawn at the top-left and only that region is copied.
        if (canvas.width < m.physWidth || canvas.height < m.physHeight) {
            canvas.width = Math.max(canvas.width, m.physWidth);
            canvas.height = Math.max(canvas.height, m.physHeight);
        }
        c2d.setTransform(1, 0, 0, 1, 0, 0);
        c2d.clearRect(0, 0, canvas.width, canvas.height);
        drawGlyph(c2d, dpi, raster, m, 0, 0);
        const texture = imageTexture(device, 'Text Texture', m.physWidth, m.physHeight);
        uploadImage(device, canvas, texture, m.physWidth, m.physHeight);
        return texture;
    }

    const drawName = 'Text';
    /** Per instance: quad rect, atlas sub-rect, anchor with cos and sin, opacity. */
    const LABEL_LAYOUT = ['float32x4', 'float32x4', 'float32x4', 'float32'];
    const LABEL_STRIDE = 13;
    /**
     * Upload time above which a mark stops rasterizing the rotation into its
     * labels. A rotated label costs roughly 0.15 ms, all of it inside the atlas
     * upload rather than at the call that asked for it, so the choice is made for a
     * whole draw from what the last one cost. Half a frame of crisp labels and half
     * of turned ones would be worse than either.
     */
    const UPLOAD_BUDGET_MS = 2.5;
    function getResources(device, ctx, vb) {
        return getMarkResources(ctx, 'text', device, vb, () => {
            const bufferManager = new BufferManager(device, drawName);
            const vertexManager = new VertexBufferManager([], LABEL_LAYOUT);
            // a blend is baked into the pipeline state, so each mode needs its own
            const pipelineFor = blendPipelines(ctx, device, `${drawName}`, drawName, vertexManager);
            const atlas = new TextAtlas(device, texture => ctx._renderer.deferDestroy(texture));
            const scratch = document.createElement('canvas');
            const scratchCtx = scratch.getContext('2d');
            return {
                device,
                bufferManager,
                pipelineFor,
                atlas,
                exact: true,
                scratch,
                scratchCtx,
            };
        });
    }
    /** Kept per item, so a label that has not changed is not measured again. */
    const heldLabels = new WeakMap();
    /**
     * The label's metrics and atlas key, measured again only when something they
     * come from changed. Keyed by the scene item, since `raster` may be a copy.
     */
    function labelOf(ctx, item, raster, vb, turn) {
        const dpi = ctx._uniforms.dpi || 1;
        const style = textCacheKey(raster);
        const held = heldLabels.get(item);
        if (held &&
            held.style === style &&
            held.x === raster.x &&
            held.y === raster.y &&
            held.radius === raster.radius &&
            held.theta === raster.theta &&
            held.dpi === dpi &&
            held.vx === vb.x1 &&
            held.vy === vb.y1 &&
            held.turn[0] === turn[0] &&
            held.turn[1] === turn[1]) {
            return held;
        }
        const metrics = glyphMetrics(ctx, raster, vb, turn);
        const key = metrics ? `${style}|${dpi}|${metrics.anchorTexX}|${metrics.anchorTexY}` : '';
        const label = {
            style,
            x: raster.x,
            y: raster.y,
            radius: raster.radius,
            theta: raster.theta,
            dpi,
            vx: vb.x1,
            vy: vb.y1,
            turn,
            metrics,
            key,
        };
        heldLabels.set(item, label);
        return label;
    }
    /** Slot for one rasterization of a label, drawn into the atlas on a miss. */
    function getSlot(ctx, res, item, raster, vb, turn) {
        const dpi = ctx._uniforms.dpi || 1;
        const { metrics, key } = labelOf(ctx, item, raster, vb, turn);
        if (!metrics) {
            return null;
        }
        const cached = res.atlas.find(key);
        if (cached) {
            return cached;
        }
        const slot = res.atlas.alloc(key, metrics);
        if (!slot) {
            return null;
        }
        drawGlyph(res.atlas.context, dpi, raster, metrics, slot.x, slot.y);
        return slot;
    }
    /**
     * Places a label, with the rotation rasterized in, or upright with the quad
     * turning it when this draw is not rasterizing rotations.
     *
     * A draw commits to one or the other for every label it has. Taking the
     * rasterized one just because it happened to still be in the atlas mixed the
     * two, and since the atlas recycles, a label swapped between them from frame to
     * frame and visibly shifted.
     */
    function place(ctx, res, item, vb, turn, exact) {
        if (turn === NO_TURN || exact) {
            const slot = getSlot(ctx, res, item, item, vb, NO_TURN);
            return slot && { slot, turn: NO_TURN };
        }
        const slot = getSlot(ctx, res, item, upright(item), vb, turn);
        return slot && { slot, turn };
    }
    /**
     * Places one label's quad, in logical pixels. The offsets are not rounded here:
     * glyphMetrics already chose the anchor offset that lands the turned corner on
     * a whole device pixel.
     */
    function labelRect(vb, dpi, item, m, shift) {
        const [ax, ay] = textAnchor(item);
        const originPhysX = (ax - vb.x1) * dpi - m.anchorTexX + shift[0];
        const originPhysY = (ay - vb.y1) * dpi - m.anchorTexY + shift[1];
        return [
            vb.x1 + originPhysX / dpi,
            vb.y1 + originPhysY / dpi,
            vb.x1 + (originPhysX + m.physWidth) / dpi,
            vb.y1 + (originPhysY + m.physHeight) / dpi,
        ];
    }
    /**
     * Rotation and sub-pixel phase are baked into the atlas, so every label is a
     * plain axis-aligned quad on a whole device pixel and maps 1:1 without
     * resampling. The shader maps (position - vb) * dpi to device pixels.
     */
    function draw(device, ctx, scene, vb) {
        const items = markItems(scene);
        if (items.length === 0) {
            return;
        }
        const res = getResources(device, ctx, vb);
        const dpi = ctx._uniforms.dpi || 1;
        const drift = ctx._textDrift?.get(scene);
        const settling = ctx._renderer.settling;
        // The option pins the cheaper path on, which nothing else can do: res.exact
        // only ever drops under load and the settling frame puts it back.
        const allowed = ctx._renderer.wgOptions.exactRotatedText !== false;
        const exact = allowed && (settling || res.exact);
        let deferred = false;
        res.atlas.begin();
        // Atlas coordinates stay in pixels until the batch closes, since begin may
        // have resized it and every slot in a batch shares one size.
        const packed = [];
        // which labels draw together, recorded as they pack and drawn once the atlas
        // has its final size
        const runs = [];
        const run = new DrawRun(ctx._opaqueBackdrop, (labels, blend) => {
            runs.push({ blend, first: labels[0], count: labels.length });
        });
        const oversized = [];
        for (const item of items) {
            const opacity = item.opacity == null ? 1 : item.opacity;
            if (opacity === 0 || (item.fontSize ?? 11) <= 0 || item.text == null || String(item.text).length === 0) {
                continue;
            }
            const [ax, ay] = textAnchor(item);
            const turn = turnOf(item);
            const blend = blendKey(item.blend);
            const placed = place(ctx, res, item, vb, turn, exact);
            deferred ||= placed !== null && placed.turn !== NO_TURN;
            if (placed) {
                const { slot } = placed;
                const [x1, y1, x2, y2] = labelRect(vb, dpi, item, slot, driftShift(ctx, item, vb, placed.turn, drift));
                run.add(packed.length / LABEL_STRIDE, blend);
                packed.push(x1, y1, x2, y2, slot.x, slot.y, slot.x + slot.physWidth, slot.y + slot.physHeight, ax, ay, placed.turn[0], placed.turn[1], opacity);
                continue;
            }
            // A label the atlas cannot hold takes the same decision as the rest of the
            // draw, or it would be the one label that does not move with the others.
            const spun = turn !== NO_TURN && !exact;
            const raster = spun ? upright(item) : item;
            const metrics = glyphMetrics(ctx, raster, vb, spun ? turn : NO_TURN);
            if (!metrics) {
                continue;
            }
            const texture = rasterizeText(device, res.scratch, res.scratchCtx, dpi, raster, metrics);
            ctx._renderer.deferDestroy(texture);
            const [x1, y1, x2, y2] = labelRect(vb, dpi, item, metrics, driftShift(ctx, item, vb, spun ? turn : NO_TURN, drift));
            const [cos, sin] = spun ? turn : NO_TURN;
            oversized.push({
                texture,
                data: Float32Array.from([x1, y1, x2, y2, 0, 0, 1, 1, ax, ay, cos, sin, opacity]),
                blend,
            });
        }
        run.flush();
        const t0 = performance.now();
        res.atlas.flush();
        if (!settling && performance.now() - t0 > UPLOAD_BUDGET_MS) {
            res.exact = false;
        }
        if (deferred) {
            ctx._renderer.requestSettle();
        }
        const size = res.atlas.size;
        for (let i = 0; i < packed.length; i += LABEL_STRIDE) {
            packed[i + 4] /= size;
            packed[i + 5] /= size;
            packed[i + 6] /= size;
            packed[i + 7] /= size;
        }
        const uniformBuffer = res.bufferManager.sharedUniformBuffer();
        // a pipeline with a default layout owns its bind group layout, so both groups
        // come from the blend variant a draw uses, and the atlas ones are held per blend
        const atlasGroups = new Map();
        const bindGroups = (pipeline, texture) => [
            uniformBindGroup(ctx, device, drawName, pipeline, uniformBuffer),
            textureBindGroup(device, 'Text Texture Bind Group', pipeline, linearSampler(device), viewOf(texture)),
        ];
        if (packed.length > 0) {
            const buffer = res.bufferManager.createInstanceBuffer(Float32Array.from(packed));
            for (const { blend, first, count } of runs) {
                const pipeline = res.pipelineFor(blend);
                let groups = atlasGroups.get(blend);
                if (!groups) {
                    groups = bindGroups(pipeline, res.atlas.texture);
                    atlasGroups.set(blend, groups);
                }
                ctx._renderQueue.enqueue({
                    pipeline,
                    drawCounts: [6, count, 0, first],
                    vertexBuffers: [buffer],
                    bindGroups: groups,
                    clip: ctx._clip,
                });
            }
        }
        for (const extra of oversized) {
            const pipeline = res.pipelineFor(extra.blend);
            ctx._renderQueue.enqueue({
                pipeline,
                drawCounts: [6, 1],
                vertexBuffers: [res.bufferManager.createInstanceBuffer(extra.data)],
                bindGroups: bindGroups(pipeline, extra.texture),
                clip: ctx._clip,
            });
        }
    }
    var text = { draw };

    var trail = oneShapeMark({ type: 'trail', name: 'Trail', shapeOf: trail$1, maskOutline: true });

    const marks = {
        arc,
        area,
        group,
        image,
        line,
        path,
        rect,
        rule,
        shape,
        symbol,
        text,
        trail,
    };

    /** Two timestamps, one frame: the pass start and the pass end. */
    const QUERY_COUNT = 2;
    const RESOLVE_BYTES = QUERY_COUNT * 8;
    /**
     * Measures how long the gpu spent on a frame, using timestamp queries written
     * around the render pass.
     *
     * Waiting on `onSubmittedWorkDone` would give the same answer and stop the cpu
     * from running ahead, which is the thing worth measuring in the first place.
     * These are read back a frame or more later instead, and a frame is skipped
     * while a previous read is still mapping, so the sample rate drops rather than
     * the frame rate.
     */
    class GpuTimer {
        querySet;
        resolveBuffer;
        readBuffer;
        reading = false;
        /** Gpu time for the most recently measured frame, in milliseconds. */
        lastMs = 0;
        constructor(device) {
            this.querySet = device.createQuerySet({ label: 'Frame Timer', type: 'timestamp', count: QUERY_COUNT });
            this.resolveBuffer = device.createBuffer({
                label: 'Frame Timer Resolve',
                size: RESOLVE_BYTES,
                usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
            });
            this.readBuffer = device.createBuffer({
                label: 'Frame Timer Readback',
                size: RESOLVE_BYTES,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
            });
        }
        /** Null where the adapter does not offer timestamps, which is common. */
        static create(device) {
            return device.features.has('timestamp-query') ? new GpuTimer(device) : null;
        }
        /** Passed to beginRenderPass so the gpu stamps the pass boundaries. */
        timestampWrites() {
            return { querySet: this.querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 };
        }
        /** Copies the stamps out, inside the frame's own encoder. */
        resolve(encoder) {
            encoder.resolveQuerySet(this.querySet, 0, QUERY_COUNT, this.resolveBuffer, 0);
            if (!this.reading) {
                encoder.copyBufferToBuffer(this.resolveBuffer, 0, this.readBuffer, 0, RESOLVE_BYTES);
            }
        }
        /** Reads the previous frame's stamps without blocking this one. */
        sample() {
            if (this.reading) {
                return;
            }
            this.reading = true;
            this.readBuffer
                .mapAsync(GPUMapMode.READ)
                .then(() => {
                const stamps = new BigUint64Array(this.readBuffer.getMappedRange().slice(0));
                this.readBuffer.unmap();
                const elapsed = stamps[1] - stamps[0];
                if (elapsed > 0n) {
                    this.lastMs = Number(elapsed) / 1e6;
                }
            })
                .catch(() => {
                // a lost device rejects this, and the pixel output is the real check
            })
                .finally(() => {
                this.reading = false;
            });
        }
        destroy() {
            this.querySet.destroy();
            this.resolveBuffer.destroy();
            this.readBuffer.destroy();
        }
    }

    /**
     * Collects draw calls for one frame and submits them in a single command
     * buffer. Each WebGPURenderer instance owns its own queue, so multiple
     * views on a page do not interfere with each other.
     */
    class RenderQueue {
        queue = [];
        batch = new GeometryBatch();
        batchInfo = null;
        offFrame = false;
        compositor = null;
        /** Starts a frame, with the compositor its layered draws fold back through. */
        startFrame(compositor) {
            this.queue = [];
            this.batch = new GeometryBatch();
            this.batchInfo = null;
            this.offFrame = false;
            this.compositor = compositor;
        }
        /** Whether anything this frame draws somewhere other than the frame itself. */
        drawsOffFrame() {
            // an open batch only joins the queue when it closes, and it may be a layer
            this.flushBatch();
            return this.offFrame;
        }
        enqueue(element) {
            // A direct draw comes after everything the open batch has collected, and
            // the batch is only appended when it flushes, so it has to close first.
            // Closing only on a different pipeline let a draw that shares one jump in
            // front of it, and markPipeline keys on the layout rather than the label,
            // so every mark's outline pipeline is the same object as a line's batch.
            // Runs still merge across marks: setupBatch keeps an open batch whose
            // target matches, which is where that happens.
            if (this.batchInfo !== null) {
                this.flushBatch();
            }
            // A mode the blend state cannot express draws into a layer and is folded in
            // straight after, so each draw meets the frame on its own the way canvas
            // composites a fill and then a stroke.
            const blend = layerMode(element.pipeline);
            if (blend !== undefined && this.compositor) {
                this.offFrame = true;
                this.queue.push({ ...element, pass: 'layer' });
                this.queue.push(this.compositor(blend, element.clip));
                return;
            }
            if (element.pass) {
                this.offFrame = true;
            }
            this.queue.push(element);
        }
        /**
         * Starts collecting instances that share one pipeline (e.g. the segments
         * of many line marks) so they can be issued as a single draw call.
         * A subsequent draw with a different pipeline flushes the batch, keeping
         * the paint order of the scenegraph intact.
         */
        setupBatch(info) {
            if (this.batchInfo !== null && sameBatchTarget(this.batchInfo, info)) {
                return;
            }
            this.flushBatch();
            this.batchInfo = info;
        }
        /** Adds one mark's instances to the open batch. */
        queueBatchInstance(values) {
            this.batch.push(values);
        }
        flushBatch() {
            const info = this.batchInfo;
            this.batchInfo = null;
            const values = this.batch.flush();
            if (info === null || values === null) {
                return;
            }
            const data = uploadBuffer(info.device, 'RenderBatch Instance Buffer', values, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);
            const instanceCount = values.length / info.vertexManager.getInstanceLength();
            this.enqueue({
                pipeline: info.pipeline,
                drawCounts: [info.vertexCount ?? 6, instanceCount],
                vertexBuffers: [data],
                bindGroups: info.bindGroups,
                clip: info.clip,
            });
        }
        /**
         * Encodes all queued draws into render passes and submits them.
         * Scissor rects are clamped to the attachment size. WebGPU validation
         * rejects scissor rects that extend beyond the render target.
         */
        submit(device, renderPassDescriptor, attachmentSize, timer, targets) {
            this.flushBatch();
            const queue = this.queue;
            this.queue = [];
            const commandEncoder = device.createCommandEncoder({ label: 'RenderQueue Encoder' });
            if (targets && queue.some(q => q.pass)) {
                encodeSplit(commandEncoder, renderPassDescriptor, queue, attachmentSize, targets);
            }
            else {
                // All draws share one render pass: the attachment is loaded/cleared and
                // resolved exactly once per frame. Draw order = scenegraph paint order.
                const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
                const state = freshPass();
                for (const q of queue) {
                    encodeDraw(passEncoder, q, attachmentSize, state);
                }
                passEncoder.end();
            }
            timer?.resolve(commandEncoder);
            device.queue.submit([commandEncoder.finish()]);
            timer?.sample();
        }
    }
    /**
     * The same draws, with each run of off-frame elements lifted into a pass of its
     * own. The frame's pass is broken either side of the run and resumed with a
     * load, so the only difference the frame sees is that the composite following
     * the run reads a finished target.
     *
     * A mask run needs nothing of the frame, so the pass before it can skip its
     * MSAA resolve. A layer run reads the frame underneath the mark, so the pass
     * before that one has to resolve before the copy. The timer keeps its two
     * stamps across the whole set, and a pass carrying neither is rejected.
     */
    function encodeSplit(encoder, descriptor, queue, attachmentSize, targets) {
        const attachment = [...descriptor.colorAttachments][0];
        const stamps = descriptor.timestampWrites;
        const segments = [];
        for (const q of queue) {
            const kind = q.pass ?? 'frame';
            const last = segments[segments.length - 1];
            // A run draws into one target, so two masks with different ones cannot
            // share a pass however adjacent they are.
            if (last && last.kind === kind && last.items[0].maskView === q.maskView) {
                last.items.push(q);
            }
            else {
                segments.push({ kind, items: [q] });
            }
        }
        const runs = segments.filter(seg => seg.kind !== 'frame');
        const frames = runs.length + 1;
        const beginFrame = (index) => {
            const colour = { ...attachment };
            if (index > 0) {
                colour.loadOp = 'load';
                colour.storeOp = 'store';
            }
            if (index < frames - 1 && runs[index]?.kind !== 'layer') {
                colour.resolveTarget = undefined;
            }
            const pass = { ...descriptor, colorAttachments: [colour], timestampWrites: undefined };
            if (stamps && (index === 0 || index === frames - 1)) {
                const writes = { querySet: stamps.querySet };
                if (index === 0) {
                    writes.beginningOfPassWriteIndex = stamps.beginningOfPassWriteIndex;
                }
                if (index === frames - 1) {
                    writes.endOfPassWriteIndex = stamps.endOfPassWriteIndex;
                }
                pass.timestampWrites = writes;
            }
            return encoder.beginRenderPass(pass);
        };
        const beginRun = (kind, view, resolve) => {
            if (kind === 'mask') {
                return encoder.beginRenderPass({
                    label: 'Coverage Mask',
                    colorAttachments: [
                        {
                            view: view ?? targets.maskView,
                            resolveTarget: resolve,
                            clearValue: { r: 0, g: 0, b: 0, a: 0 },
                            loadOp: 'clear',
                            storeOp: 'store',
                        },
                    ],
                });
            }
            encoder.copyTextureToTexture({ texture: targets.target }, { texture: targets.backdrop }, [
                attachmentSize[0],
                attachmentSize[1],
                1,
            ]);
            return encoder.beginRenderPass({
                label: 'Blend Layer',
                colorAttachments: [
                    {
                        view: targets.layerView,
                        resolveTarget: targets.layerResolve ?? undefined,
                        clearValue: { r: 0, g: 0, b: 0, a: 0 },
                        loadOp: 'clear',
                        storeOp: 'store',
                    },
                ],
            });
        };
        let index = 0;
        let passEncoder = beginFrame(0);
        let state = freshPass();
        for (const segment of segments) {
            if (segment.kind === 'frame') {
                for (const q of segment.items) {
                    encodeDraw(passEncoder, q, attachmentSize, state);
                }
                continue;
            }
            passEncoder.end();
            const runPass = beginRun(segment.kind, segment.items[0].maskView, segment.items[0].maskResolve);
            const runState = freshPass();
            for (const q of segment.items) {
                encodeDraw(runPass, q, attachmentSize, runState);
            }
            runPass.end();
            index++;
            passEncoder = beginFrame(index);
            state = freshPass();
        }
        passEncoder.end();
    }
    const freshPass = () => ({ pipeline: null, scissor: undefined });
    /** Encodes one draw, setting the scissor rect and the pipeline only where they change. */
    function encodeDraw(passEncoder, q, attachmentSize, state) {
        let clip;
        if (q.clip) {
            const clamped = clampClip(q.clip, attachmentSize);
            if (clamped === null) {
                return; // clipped to nothing
            }
            clip = clamped;
        }
        if (!sameClip(clip, state.scissor)) {
            // scissor state persists within the pass, so a draw with no clip restores full coverage
            const [x, y, w, h] = clip ?? [0, 0, attachmentSize[0], attachmentSize[1]];
            passEncoder.setScissorRect(x, y, w, h);
            state.scissor = clip;
        }
        if (q.pipeline !== state.pipeline) {
            passEncoder.setPipeline(q.pipeline);
            state.pipeline = q.pipeline;
        }
        for (let i = 0; i < q.vertexBuffers.length; i++) {
            passEncoder.setVertexBuffer(i, q.vertexBuffers[i]);
        }
        for (let i = 0; i < q.bindGroups.length; i++) {
            passEncoder.setBindGroup(i, q.bindGroups[i]);
        }
        passEncoder.draw(q.drawCounts[0], q.drawCounts[1] ?? 1, q.drawCounts[2] ?? 0, q.drawCounts[3] ?? 0);
    }
    /**
     * Instances may only share a draw when the pipeline, the scissor rect and the
     * bind groups all match. Matching on the pipeline alone merged marks from
     * differently clipped groups into one draw carrying the first mark's clip.
     */
    function sameBatchTarget(a, b) {
        if (a.pipeline !== b.pipeline || a.vertexCount !== b.vertexCount) {
            return false;
        }
        if (!sameClip(a.clip, b.clip)) {
            return false;
        }
        return a.bindGroups.length === b.bindGroups.length && a.bindGroups.every((g, i) => g === b.bindGroups[i]);
    }
    function sameClip(a, b) {
        if (a === b) {
            return true;
        }
        if (a === undefined || b === undefined) {
            return false;
        }
        return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
    }
    /** Returns the clamped rect, or null when it collapses to nothing. */
    function clampClip(clip, size) {
        const x = Math.min(Math.max(Math.floor(clip[0]), 0), size[0]);
        const y = Math.min(Math.max(Math.floor(clip[1]), 0), size[1]);
        const w = Math.min(Math.max(Math.floor(clip[2]), 0), size[0] - x);
        const h = Math.min(Math.max(Math.floor(clip[3]), 0), size[1] - y);
        if (w <= 0 || h <= 0) {
            return null;
        }
        return [x, y, w, h];
    }

    /**
     * The ratio a canvas asks for, before the renderer caps or locks it. A
     * detached canvas has no display to follow, so it stays at 1.
     */
    function pixelRatio(canvas, scaleFactor) {
        if (scaleFactor != null) {
            return scaleFactor;
        }
        const inDOM = typeof HTMLElement !== 'undefined' && canvas instanceof HTMLElement && canvas.parentNode != null;
        return inDOM ? window.devicePixelRatio || 1 : 1;
    }
    /**
     * Sizes the WebGPU canvas to the view and mirrors the coordinate transform
     * onto the detached pick canvas so geometric hit-testing (isPointInPath)
     * matches what is rendered.
     */
    function resize(canvas, context, width, height, origin, pickCanvas, pickContext, ratio) {
        canvas.width = width * ratio;
        canvas.height = height * ratio;
        pickCanvas.width = width * ratio;
        pickCanvas.height = height * ratio;
        // vega's canvas picking reads pixelRatio off the context and tests paths
        // in the same transformed space the marks are drawn in.
        pickContext.pixelRatio = ratio;
        pickContext.setTransform(ratio, 0, 0, ratio, ratio * origin[0], ratio * origin[1]);
        if (ratio !== 1) {
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
        }
        context._origin = origin;
        context._ratio = ratio;
    }

    const viewBounds = (origin, width, height) => new vegaScenegraph.Bounds().set(0, 0, width, height).translate(-origin[0], -origin[1]);
    // Upper bound on a frame capture, so a stalled readback reports instead of
    // hanging its caller.
    const CAPTURE_TIMEOUT_MS = 10_000;
    const MAX_DEVICE_RECOVERIES = 3;
    /**
     * Texture size every WebGPU device must support, used until the real adapter
     * limit is known. Nothing is over-committed by assuming it, since a device
     * cannot report less.
     */
    const MIN_TEXTURE_DIM = 8192;
    /** Quiet time before a settling frame redraws at full quality. */
    const SETTLE_DELAY_MS = 150;
    /**
     * The renderer currently drawing into an element.
     *
     * vega swaps renderers by dropping the old one and building a new one, without
     * telling the old one to let go, so its device and everything on it would stay
     * alive for as long as the page did. Taking over an element releases whoever
     * held it before.
     */
    const holders = new WeakMap();
    class WebGPURenderer extends vegaScenegraph.Renderer {
        wgOptions = {
            debugLog: false,
            cacheShapes: true,
            exactRotatedText: true,
            canvasTextDrift: false,
            renderLock: true,
            offscreen: false,
            sampleCount: defaultSampleCount,
            redrawOnZoom: true,
        };
        _canvas = null;
        // Detached 2D canvas used only as a geometric scratch context for picking
        // (isPointInPath/isPointInStroke). It is never displayed. All visible
        // rendering, including text, goes through the single WebGPU canvas.
        _pickCanvas = null;
        _pickContext = null;
        _ctx = null;
        _device = null;
        _msaa = { texture: null, device: null };
        /** Whether the last frame had to draw off the frame. Read by the tests. */
        _offFrame = false;
        _mask = { texture: null, device: null };
        _layer = { texture: null, device: null };
        _layerResolve = { texture: null, device: null };
        _backdrop = { texture: null, device: null };
        _offscreen = { texture: null, device: null };
        _queue = new RenderQueue();
        _renderCount = 0;
        /** Reason the GPU device was lost, if it ever was. Set for every reason. */
        deviceLostReason = null;
        /** Set to an object to accumulate per-mark draw time. Diagnostic only. */
        markTimings = null;
        /** Number of GPU devices this renderer has created. */
        deviceGeneration = 0;
        _recoveries = 0;
        _capture = null;
        _isRendering = false;
        _pendingRender = null;
        _gpuTimer = null;
        _finalized = false;
        _settling = false;
        _settleTimer = null;
        _lastRender = null;
        _renderPromise = Promise.resolve();
        // Stands in for a deferred frame so awaiting callers follow it, not the
        // already-settled in-flight one.
        _pendingPromise = null;
        _resolvePending = null;
        _dpr = null;
        _scaleFactor;
        _maxTextureDim = MIN_TEXTURE_DIM;
        _lockedRatio = null;
        _warnedRatioCap = false;
        constructor(loader) {
            super(loader);
        }
        initialize(el, width, height, origin, scaleFactor, opt) {
            // re-initializing this renderer, or taking the element off another one
            this._releaseGpu();
            if (el) {
                const held = holders.get(el);
                if (held && held !== this) {
                    held.finalize();
                }
                holders.set(el, this);
            }
            this._canvas = document.createElement('canvas');
            this._pickCanvas = document.createElement('canvas');
            this._pickContext = this._pickCanvas.getContext('2d');
            if (el) {
                el.setAttribute('style', 'position: relative;');
                this._canvas.setAttribute('class', 'marks');
                vegaScenegraph.domClear(el, 0);
                el.appendChild(this._canvas);
            }
            // The picking handler retrieves its 2D context through this reference,
            // since the WebGPU canvas cannot provide one.
            this._canvas._pickCanvas = this._pickCanvas;
            const ctx = this._canvas.getContext('webgpu');
            if (!ctx) {
                throw new Error('[vega-webgpu] Failed to obtain a WebGPU canvas context.');
            }
            ctx._renderer = this;
            ctx._renderQueue = this._queue;
            ctx._uniforms = { resolution: [0, 0], dpi: 1 };
            ctx._tx = 0;
            ctx._ty = 0;
            ctx._origin = [0, 0];
            ctx._ratio = 1;
            ctx._sampleCount = normalizeSampleCount(this.wgOptions.sampleCount);
            ctx._opaqueBackdrop = false;
            ctx._shaderCache = {};
            ctx._pipelineCache = {};
            ctx._markCache = {};
            ctx._pathCache = new LruMap(10_000);
            ctx._geometryCache = new LruMap(10_000);
            this._ctx = ctx;
            // this method will invoke resize to size the canvas appropriately
            return super.initialize(el, width, height, origin, scaleFactor, opt);
        }
        resize(width, height, origin, scaleFactor) {
            super.resize(width, height, origin, scaleFactor);
            this._scaleFactor = scaleFactor;
            this._watchPixelRatio();
            const o = [this._origin[0], this._origin[1]];
            if (this._canvas && this._ctx && this._pickCanvas && this._pickContext) {
                const ratio = this._pixelRatio(this._width, this._height, scaleFactor);
                resize(this._canvas, this._ctx, this._width, this._height, o, this._pickCanvas, this._pickContext, ratio);
                // devicePixelRatio disagrees with this for a detached canvas or an
                // explicit scaleFactor.
                this._ctx._uniforms = { resolution: [width, height], dpi: this._ctx._ratio };
            }
            return this;
        }
        canvas() {
            return this._canvas;
        }
        /** Stops following zoom, so the canvas keeps the size it has. */
        _unwatchPixelRatio() {
            if (this._dpr) {
                this._dpr.query.removeEventListener('change', this._dpr.onChange);
                this._dpr = null;
            }
        }
        /**
         * Takes the real ceiling from the adapter in place of the assumed minimum,
         * and re-sizes when that changes what the canvas is allowed to be.
         */
        _applyTextureLimit(limit) {
            if (limit === this._maxTextureDim) {
                return;
            }
            this._maxTextureDim = limit;
            const want = this._pixelRatio(this._width, this._height, this._scaleFactor);
            if (this._ctx && this._ctx._ratio !== want) {
                this.resize(this._width, this._height, this._origin, this._scaleFactor);
            }
        }
        /**
         * Device pixels per logical pixel for the canvas, after holding it against
         * browser zoom when `redrawOnZoom` is off and capping it to what the GPU can
         * actually allocate.
         */
        _pixelRatio(width, height, scaleFactor) {
            let ratio = this._canvas ? pixelRatio(this._canvas, scaleFactor) : (scaleFactor ?? 1);
            if (scaleFactor == null && !this.wgOptions.redrawOnZoom) {
                this._lockedRatio ??= ratio;
                ratio = this._lockedRatio;
            }
            // The canvas is a texture, so the adapter's 2D limit is a hard ceiling.
            // Dropping to a ratio that fits keeps a very large view on screen, where
            // refusing to draw it left the user with a blank chart.
            const largest = Math.max(width, height);
            const cap = largest > 0 ? this._maxTextureDim / largest : ratio;
            if (ratio <= cap) {
                return ratio;
            }
            if (!this._warnedRatioCap) {
                this._warnedRatioCap = true;
                console.warn(`[vega-webgpu] ${width}x${height} at ${ratio}x needs ${Math.ceil(largest * ratio)}px, ` +
                    `over the GPU's maximum texture size (${this._maxTextureDim}px). ` +
                    `Drawing at ${cap.toFixed(3)}x instead, so the view is softer than requested.`);
            }
            return cap;
        }
        /**
         * Redraws when the device pixel ratio changes, which browser zoom does
         * without changing the view's width or height, so nothing else asks for it.
         * A matchMedia query only fires for the ratio it was built with, so each
         * change registers the next one.
         */
        _watchPixelRatio() {
            if (this._scaleFactor != null || !this.wgOptions.redrawOnZoom) {
                // the option can be turned off after a watch was already registered
                this._unwatchPixelRatio();
                return;
            }
            if (typeof window === 'undefined' || !window.matchMedia) {
                return;
            }
            const ratio = window.devicePixelRatio || 1;
            if (this._dpr) {
                if (this._dpr.query.media === `(resolution: ${ratio}dppx)`) {
                    return;
                }
                this._dpr.query.removeEventListener('change', this._dpr.onChange);
            }
            const query = window.matchMedia(`(resolution: ${ratio}dppx)`);
            // Weak, since the query outlives a renderer vega dropped without finalizing.
            const self = new WeakRef(this);
            const onChange = () => {
                const renderer = self.deref();
                if (!renderer || renderer._finalized) {
                    query.removeEventListener('change', onChange);
                    return;
                }
                renderer.resize(renderer._width, renderer._height, renderer._origin);
                renderer.frame();
            };
            query.addEventListener('change', onChange);
            this._dpr = { query, onChange };
        }
        context() {
            return this._ctx;
        }
        device() {
            return this._device;
        }
        // No `dirty()` override: every frame redraws the whole scene, so tracking
        // per-item dirty bounds was pure overhead. Reinstate with partial redraw.
        async _reinit() {
            let device = this._device;
            const ctx = this._ctx;
            if (!ctx) {
                throw new Error('[vega-webgpu] Renderer is not initialized.');
            }
            if (!device) {
                if (typeof navigator === 'undefined' || !navigator.gpu) {
                    throw new Error('[vega-webgpu] WebGPU is not supported in this environment.');
                }
                const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
                if (!adapter) {
                    throw new Error('[vega-webgpu] No suitable GPU adapter found.');
                }
                device = await adapter.requestDevice({
                    // timestamps measure gpu time without stalling the frame, where offered
                    requiredFeatures: adapter.features.has('timestamp-query') ? ['timestamp-query'] : [],
                    // a device gets the 8192 default unless it asks for what the adapter has
                    requiredLimits: { maxTextureDimension2D: adapter.limits.maxTextureDimension2D },
                });
                this._gpuTimer = GpuTimer.create(device);
                this._device = device;
                this._applyTextureLimit(device.limits.maxTextureDimension2D);
                this.deviceGeneration++;
                this._handleDeviceLoss(device);
                ctx.configure({
                    device,
                    format: preferredColorFormat(),
                    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
                    alphaMode: 'premultiplied',
                });
            }
            return { device, ctx };
        }
        /**
         * Drops the device and everything built on it. Pipelines, textures and
         * buffers all belong to a device, so none of them outlive it. A texture slot
         * compares the device it was made on, so it rebuilds on the next one itself.
         */
        _dropDevice() {
            this._device = null;
            this._gpuTimer = null;
            this._clipMasks = [];
            this._clipMaskNext = 0;
            if (this._ctx) {
                this._ctx._shaderCache = {};
                this._ctx._pipelineCache = {};
                this._ctx._markCache = {};
            }
        }
        /**
         * A device is never destroyed from here, so every loss is the browser's,
         * including reason 'destroyed' (memory pressure reclaims a device that way).
         * Keeping the dead one leaves the renderer permanently broken.
         */
        _handleDeviceLoss(device) {
            device.lost.then(info => {
                this.deviceLostReason = `${info.reason}: ${info.message}`;
                if (this._device !== device) {
                    return; // already replaced
                }
                if (this._finalized) {
                    return; // finalize() destroyed it on purpose
                }
                console.warn(`[vega-webgpu] GPU device lost (${info.reason}: ${info.message}); reinitializing.`);
                this._dropDevice();
                // Bounded, so a device the browser keeps reclaiming cannot spin here.
                if (this._lastRender && this._recoveries < MAX_DEVICE_RECOVERIES) {
                    this._recoveries++;
                    this.frame();
                }
            });
        }
        /**
         * Unlike the base class, `_call` stays set after rendering: our `_render`
         * is asynchronous, so resource loads (images) that start mid-frame must
         * still find a live redraw callback once they complete.
         */
        render(scene, markTypes) {
            this._call = () => {
                this._render(scene, markTypes);
            };
            this._call();
            return this;
        }
        _render(scene, markTypes, settle) {
            this._lastRender = { scene, markTypes };
            if (this.wgOptions.renderLock && this._isRendering) {
                // Without a stand-in promise renderAsync would resolve against the
                // in-flight frame, so callers would read the canvas before this scene ran.
                this._pendingRender = { scene, markTypes, settle };
                if (!this._pendingPromise) {
                    this._pendingPromise = new Promise(resolve => {
                        this._resolvePending = resolve;
                    });
                }
                this._renderPromise = this._pendingPromise;
                return this;
            }
            this._isRendering = true;
            this._renderPromise = this._frame(scene, markTypes, settle).catch(err => {
                console.error('[vega-webgpu] Render failed:', err);
                // One failure must not wedge the lock or strand awaiting callers.
                const capture = this._capture;
                this._capture = null;
                capture?.reject(err);
                this._finishFrame();
            });
            return this;
        }
        /**
         * Resolves when the frame has been submitted to the GPU. vega awaits this on
         * every frame, so waiting for the GPU to finish here would stop the cpu from
         * ever running ahead of it. A caller that needs the pixels reads them back
         * through captureFrame, which is ordered behind the frame in the same queue.
         */
        async renderAsync(scene, markTypes) {
            this.render(scene, markTypes);
            await this._renderPromise;
            // wait for pending resource loads (images) and the re-renders they trigger
            while (this._ready) {
                await this._ready;
                await this._renderPromise;
            }
            return this;
        }
        /** Drops the device and the timer, without marking the renderer finished. */
        _releaseGpu() {
            if (this._settleTimer !== null) {
                clearTimeout(this._settleTimer);
                this._settleTimer = null;
            }
            const device = this._device;
            this._gpuTimer?.destroy();
            this._dropDevice();
            device?.destroy();
        }
        /**
         * Releases the GPU device and everything built on it.
         *
         * vega's own View.finalize does not reach the renderer, so a page that
         * creates and discards views leaks a device each time. Nothing recreates one
         * after this, so call it when the view is going away for good.
         */
        finalize() {
            this._finalized = true;
            this._unwatchPixelRatio();
            this._releaseGpu();
        }
        /**
         * Gpu time for the most recently measured frame, in milliseconds, or 0 where
         * the adapter offers no timestamps. Sampled a frame or more behind, so it
         * never stalls the one being drawn.
         */
        get gpuFrameTime() {
            return this._gpuTimer?.lastMs ?? 0;
        }
        /**
         * Applies a changed wgOptions.sampleCount. Pipelines bake the sample count,
         * so the per-mark GPU resources are rebuilt, and the multisampled targets go
         * rather than outliving a drop to one sample.
         */
        _applySampleCount(ctx) {
            const requested = normalizeSampleCount(this.wgOptions.sampleCount);
            if (requested === ctx._sampleCount) {
                return;
            }
            ctx._sampleCount = requested;
            ctx._markCache = {};
            for (const slot of [this._msaa, this._layer]) {
                slot.texture?.destroy();
                slot.texture = null;
            }
        }
        async _frame(scene, markTypes, settle) {
            const tFrameStart = performance.now();
            const { device, ctx } = await this._reinit();
            this._applySampleCount(ctx);
            this._queue.startFrame((blendMode, clip) => blendCompositeElement(ctx, device, blendMode, clip));
            const o = this._origin;
            const w = this._width;
            const h = this._height;
            const vb = viewBounds([o[0], o[1]], w, h);
            ctx._tx = 0;
            ctx._ty = 0;
            // The group visit restores these as it unwinds, so this is only in case a
            // frame gave up part way through one.
            ctx._clip = undefined;
            ctx._clipRound = undefined;
            ctx._clipMask = undefined;
            this._clipMaskNext = 0;
            // Read per frame rather than once: vega sets the background after it builds
            // the renderer, and a view can change it later.
            ctx._opaqueBackdrop = this.clearColor().a >= 1;
            ctx._textDrift = this.wgOptions.canvasTextDrift ? canvasTextDrift(scene, o, ctx._uniforms.dpi || 1) : null;
            const t1 = performance.now();
            this._settling = settle === true;
            try {
                this.draw(device, ctx, scene, vb, markTypes);
            }
            finally {
                this._settling = false;
            }
            const t2 = performance.now();
            // One pass for the whole frame: clears to the background color, draws in
            // scenegraph order (there is no depth attachment), and resolves the MSAA
            // attachment once.
            const target = this.wgOptions.offscreen ? this.offscreenTexture(device) : ctx.getCurrentTexture();
            const multisampled = ctx._sampleCount > 1;
            const renderPassDescriptor = {
                label: 'Frame Render Pass Descriptor',
                colorAttachments: [
                    {
                        // the canvas hands out a new texture every frame, so its view is not held
                        view: multisampled ? viewOf(this.msaaTexture(device, ctx._sampleCount)) : target.createView(),
                        resolveTarget: multisampled ? target.createView() : undefined,
                        clearValue: this.clearColor(),
                        loadOp: 'clear',
                        storeOp: 'store',
                    },
                ],
            };
            if (this._gpuTimer) {
                renderPassDescriptor.timestampWrites = this._gpuTimer.timestampWrites();
            }
            const tSubmit = performance.now();
            this._offFrame = this._queue.drawsOffFrame();
            // Built only when a draw asked for one. They are the size of the canvas,
            // and a frame that neither masks nor blends should not carry them.
            let targets = null;
            if (this._offFrame) {
                const blend = this.blendTargets(device, ctx._sampleCount);
                targets = {
                    target,
                    maskView: viewOf(this.maskTexture(device)),
                    layerView: viewOf(blend.layer),
                    layerResolve: ctx._sampleCount > 1 ? viewOf(blend.resolve) : null,
                    backdrop: blend.backdrop,
                };
            }
            this._queue.submit(device, renderPassDescriptor, [this._canvas?.width ?? 0, this._canvas?.height ?? 0], this._gpuTimer, targets);
            if (this.markTimings) {
                this.markTimings['_draw'] = (this.markTimings['_draw'] ?? 0) + (t2 - t1);
                this.markTimings['_submit'] = (this.markTimings['_submit'] ?? 0) + (performance.now() - tSubmit);
                this.markTimings['_reinit'] = (this.markTimings['_reinit'] ?? 0) + (t1 - tFrameStart);
            }
            if (this._capture) {
                const capture = this._capture;
                this._capture = null;
                this._readback(device, target).then(capture.resolve, capture.reject);
            }
            // The work is on the GPU, so the lock goes now. Waiting for the next
            // animation frame to release it deferred any render arriving inside that
            // window, which is a dragged slider rendering a frame behind.
            this._endFrame(t1, t2);
        }
        _endFrame(t1, t2) {
            if (this.wgOptions.debugLog === true) {
                const t3 = performance.now();
                console.log(`Render Time (${this._renderCount++}): ${(t3 - t1).toFixed(3)}ms ` +
                    `(Draw: ${(t2 - t1).toFixed(3)}ms, Encode: ${(t3 - t2).toFixed(3)}ms)`);
            }
            this._finishFrame();
        }
        /**
         * Renders a frame and reads the result straight off the GPU.
         *
         * Presentation is what makes canvas content visible to screenshots and to
         * toDataURL, and a headless Linux runner never composites, so both come back
         * blank there. Copying the texture bypasses presentation entirely.
         */
        async captureFrame(timeoutMs = CAPTURE_TIMEOUT_MS) {
            try {
                return await this._captureOnce(timeoutMs);
            }
            catch {
                // A device that goes away mid-capture takes its readback buffer with it,
                // and mapAsync then rejects with the instance already gone. Rebuild and
                // take the frame again, letting a second failure through.
                this._dropDevice();
                return await this._captureOnce(timeoutMs);
            }
        }
        _captureOnce(timeoutMs) {
            return new Promise((resolve, reject) => {
                if (!this._lastRender) {
                    reject(new Error('[vega-webgpu] Nothing has been rendered yet.'));
                    return;
                }
                // Never hang. A capture that cannot complete has to say so, otherwise the
                // caller just stops, with no clue whether the frame, the copy or the
                // buffer mapping was the part that never finished.
                const timer = setTimeout(() => {
                    if (this._capture) {
                        this._capture = null;
                        reject(new Error(`[vega-webgpu] Frame capture did not finish within ${timeoutMs}ms ` +
                            `(rendering=${this._isRendering}, pending=${this._pendingRender !== null}).`));
                    }
                }, timeoutMs);
                const done = (fn) => (value) => {
                    clearTimeout(timer);
                    fn(value);
                };
                this._capture = { resolve: done(resolve), reject: done(reject) };
                // A capture is the finished picture, so it draws at full quality.
                this.frame(true);
            });
        }
        /** Copies a texture into a mappable buffer and unpads it to tight RGBA rows. */
        async _readback(device, texture) {
            const width = texture.width;
            const height = texture.height;
            // copyTextureToBuffer requires each row to start on a 256 byte boundary
            const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
            const buffer = device.createBuffer({
                label: 'Capture Readback',
                size: bytesPerRow * height,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
            });
            const encoder = device.createCommandEncoder({ label: 'Capture Encoder' });
            encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [width, height, 1]);
            device.queue.submit([encoder.finish()]);
            await buffer.mapAsync(GPUMapMode.READ);
            const padded = new Uint8Array(buffer.getMappedRange());
            const data = new Uint8Array(width * height * 4);
            for (let y = 0; y < height; y++) {
                data.set(padded.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4);
            }
            buffer.unmap();
            // The texels come back in the canvas format, which is bgra8unorm on most
            // platforms. Callers want RGBA.
            if (preferredColorFormat() === 'bgra8unorm') {
                for (let i = 0; i < data.length; i += 4) {
                    const b = data[i];
                    data[i] = data[i + 2];
                    data[i + 2] = b;
                }
            }
            // The surface is premultiplied, but getImageData and toDataURL both hand
            // back straight alpha, so callers comparing the two need the same.
            for (let i = 0; i < data.length; i += 4) {
                const a = data[i + 3];
                if (a !== 0 && a !== 255) {
                    data[i] = Math.min(255, Math.round((data[i] * 255) / a));
                    data[i + 1] = Math.min(255, Math.round((data[i + 1] * 255) / a));
                    data[i + 2] = Math.min(255, Math.round((data[i + 2] * 255) / a));
                }
            }
            buffer.destroy();
            return { width, height, data };
        }
        /**
         * Destroys a GPU resource once the frame after this one is submitted, the way
         * the buffers a frame makes go. Safe to call from inside a mark's draw, where
         * the resource may still be referenced by a queued but not yet encoded draw.
         */
        deferDestroy(resource) {
            if (this._device) {
                bufferPool(this._device).hold(resource);
            }
            else {
                resource.destroy();
            }
        }
        /**
         * Releases the render lock and flushes a coalesced request, if any.
         *
         * Every exit from a frame (completion, early return, or failure) must come
         * through here, or `_isRendering` stays stuck and awaiting callers never wake.
         */
        _finishFrame() {
            this._isRendering = false;
            // The frame is submitted, so the buffers its draws used can go. An
            // implementation keeps a destroyed buffer alive until the commands
            // referencing it have run.
            if (this._device) {
                bufferPool(this._device).release();
            }
            const pending = this._pendingRender;
            this._pendingRender = null;
            const resolve = this._resolvePending;
            this._pendingPromise = null;
            this._resolvePending = null;
            if (pending) {
                this._render(pending.scene, pending.markTypes, pending.settle);
                // Settle only once the flushed frame does, so callers track real work.
                this._renderPromise.then(() => resolve?.(), () => resolve?.());
                return;
            }
            resolve?.();
        }
        /**
         * Re-renders the most recent scene (e.g. after options changed). `settle`
         * draws it at full quality, the way the frame a drag comes to rest on is.
         */
        frame(settle) {
            if (this._lastRender) {
                this._render(this._lastRender.scene, this._lastRender.markTypes, settle);
            }
            return this;
        }
        /** True while drawing a frame that is not allowed to take a cheaper path. */
        get settling() {
            return this._settling;
        }
        /**
         * Asks for one more frame once renders stop arriving, for a mark that took a
         * cheaper path to keep up. Each render pushes it back, so a drag pays nothing
         * and the frame it comes to rest on is the full quality one.
         */
        requestSettle() {
            if (this._finalized || this._settling) {
                return;
            }
            if (this._settleTimer !== null) {
                clearTimeout(this._settleTimer);
            }
            this._settleTimer = setTimeout(() => {
                this._settleTimer = null;
                this.frame(true);
            }, SETTLE_DELAY_MS);
        }
        draw(device, ctx, scene, bounds, markTypes) {
            if (scene.marktype !== 'group' && markTypes != null && !markTypes.includes(scene.marktype)) {
                return;
            }
            const mark = marks[scene.marktype];
            if (mark == null) {
                console.error(`[vega-webgpu] Unknown mark type: '${scene.marktype}'`);
                return;
            }
            // A mark can carry a clip of its own, which narrows what it sits inside
            // while it draws. vega's renderer clips here, before the mark type has been
            // looked at, so a group mark is clipped the same way any other mark is. A
            // path is a coverage mask as well, drawn here rather than inside the mark
            // because getMarkResources writes the flag that says a mask is bound, and
            // every mark calls that before it enqueues anything.
            const { _clip: outerClip, _clipRound: outerRound, _clipMask: outerMask } = ctx;
            const own = scene.clip;
            if (typeof own === 'function') {
                ctx._clipMask = drawClipMask(device, ctx, own, bounds) ?? outerMask;
                pushPathClip(ctx, own);
            }
            else if (own && scene.group) {
                pushGroupClip(ctx, scene.group);
            }
            try {
                this.drawMark(mark, device, ctx, scene, bounds, markTypes);
            }
            finally {
                ctx._clip = outerClip;
                ctx._clipRound = outerRound;
                ctx._clipMask = outerMask;
            }
        }
        /** The mark's own draw, timed when a benchmark has asked for it. */
        drawMark(mark, device, ctx, scene, bounds, markTypes) {
            if (this.markTimings) {
                const t0 = performance.now();
                mark.draw.call(this, device, ctx, scene, bounds, markTypes);
                const key = scene.marktype;
                this.markTimings[key] = (this.markTimings[key] ?? 0) + (performance.now() - t0);
                return;
            }
            mark.draw.call(this, device, ctx, scene, bounds, markTypes);
        }
        /**
         * A 1x1 texture bound wherever a mark has no clip path, so the mask binding
         * is always satisfiable. Nothing reads it: the uniform flag is what decides
         * whether the shader looks at the mask at all.
         */
        clipMaskPlaceholder(device) {
            return this.slotTexture(this._clipPlaceholder, device, {
                label: 'Clip Mask Placeholder',
                size: [1, 1, 1],
                format: MASK_FORMAT,
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            });
        }
        /**
         * A coverage target for one clip path, which has to survive while every mark
         * inside that clip draws. The stroke mask is one texture cleared by each
         * pass, so a clip cannot share it: two clipped groups in a frame would
         * overwrite each other before either one's marks were encoded.
         *
         * Pooled by index and reset per frame, so a scene with the same clips each
         * frame allocates nothing after the first.
         */
        acquireClipMask(device, samples) {
            const canvas = this._canvas;
            if (!canvas) {
                return null;
            }
            const [w, h] = [canvas.width, canvas.height];
            const held = this._clipMasks[this._clipMaskNext];
            if (held && held.device === device && held.width === w && held.height === h && held.samples === samples) {
                this._clipMaskNext++;
                return held;
            }
            held?.release();
            const resolved = device.createTexture({
                label: `Clip Mask ${this._clipMaskNext}`,
                size: [w, h, 1],
                format: MASK_FORMAT,
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
            });
            // Coverage of a filled path comes from rasterization rather than from a
            // distance function, so a single sampled mask cuts with a hard edge where
            // canvas antialiases the clip. Multisampled and resolved, it carries the
            // same quarter steps every other triangulated edge does.
            const multi = samples > 1
                ? device.createTexture({
                    label: `Clip Mask ${this._clipMaskNext} MSAA`,
                    size: [w, h, 1],
                    format: MASK_FORMAT,
                    sampleCount: samples,
                    usage: GPUTextureUsage.RENDER_ATTACHMENT,
                })
                : null;
            const entry = {
                device,
                width: w,
                height: h,
                samples,
                attachment: (multi ?? resolved).createView(),
                resolve: multi ? resolved.createView() : undefined,
                read: resolved.createView(),
                release: () => {
                    resolved.destroy();
                    multi?.destroy();
                },
            };
            this._clipMasks[this._clipMaskNext] = entry;
            this._clipMaskNext++;
            return entry;
        }
        _clipMasks = [];
        _clipMaskNext = 0;
        clipMaskPlaceholderView(device) {
            return viewOf(this.clipMaskPlaceholder(device));
        }
        _clipPlaceholder = { texture: null, device: null };
        /**
         * Single sampled coverage target, for a stroke that has to be composited as
         * one shape rather than band by band. One per frame is enough: each mask pass
         * clears it, and the composite that follows reads it before the next pass
         * fills it again.
         */
        maskTexture(device) {
            return this.canvasTexture(this._mask, device, 'mask texture', size => ({
                label: 'Coverage Mask Texture',
                size,
                format: MASK_FORMAT,
                dimension: '2d',
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
            }));
        }
        /** The texture in `slot`, sized to the canvas. */
        canvasTexture(slot, device, what, describe) {
            const gpu = device ?? this._device;
            const canvas = this._canvas;
            if (!gpu || !canvas) {
                throw new Error(`[vega-webgpu] Cannot create the ${what} before initialization.`);
            }
            return this.slotTexture(slot, gpu, describe([canvas.width, canvas.height, 1]));
        }
        /**
         * The texture in `slot`, rebuilt when the device, the size or the sample count
         * it was made with is not what `want` describes.
         */
        slotTexture(slot, device, want) {
            const held = slot.texture;
            const [width, height] = want.size;
            if (held &&
                slot.device === device &&
                held.width === width &&
                held.height === height &&
                held.sampleCount === (want.sampleCount ?? 1)) {
                return held;
            }
            held?.destroy();
            slot.texture = device.createTexture(want);
            slot.device = device;
            return slot.texture;
        }
        /**
         * Where a mark whose blend has to be evaluated in a shader is drawn, and the
         * copy of the frame underneath it. The layer takes the frame's own format and
         * sample count, so a mark draws into it through the pipelines it already has.
         */
        blendTargets(device, samples) {
            const format = preferredColorFormat();
            const resolve = this.canvasTexture(this._layerResolve, device, 'blend targets', size => ({
                label: 'Blend Layer Resolve',
                size,
                format,
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
            }));
            const backdrop = this.canvasTexture(this._backdrop, device, 'blend targets', size => ({
                label: 'Blend Backdrop',
                size,
                format,
                usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
            }));
            const layer = samples > 1
                ? this.canvasTexture(this._layer, device, 'blend targets', size => ({
                    label: 'Blend Layer',
                    size,
                    format,
                    sampleCount: samples,
                    usage: GPUTextureUsage.RENDER_ATTACHMENT,
                }))
                : resolve;
            return { layer, resolve, backdrop };
        }
        /**
         * Whether the last frame needed a pass outside the frame's own, for a
         * coverage mask or a blend evaluated against a copy of it. The fast path for
         * a blend is silent when it stops being taken, so a test watches this.
         */
        drewOffFrame() {
            return this._offFrame;
        }
        /** Multisampled color attachment, resolved into the canvas each frame. */
        msaaTexture(device, samples) {
            return this.canvasTexture(this._msaa, device, 'MSAA texture', size => ({
                label: 'MSAA Color Texture',
                size,
                format: preferredColorFormat(),
                dimension: '2d',
                sampleCount: samples,
                usage: GPUTextureUsage.RENDER_ATTACHMENT,
            }));
        }
        /**
         * Color target for offscreen mode. Acquiring the canvas swapchain destroys
         * the device where no compositor exists, so that call is skipped entirely and
         * the frame lands here instead.
         */
        offscreenTexture(device) {
            const canvas = this._canvas;
            if (!canvas) {
                throw new Error('[vega-webgpu] Cannot create the offscreen texture before initialization.');
            }
            return this.canvasTexture(this._offscreen, device, 'offscreen texture', size => ({
                label: 'Offscreen Color Texture',
                size,
                format: preferredColorFormat(),
                dimension: '2d',
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
            }));
        }
        clearColor() {
            if (!this._bgcolor) {
                // canvas clears to transparent and only fills when a background is set
                return { r: 0.0, g: 0.0, b: 0.0, a: 0.0 };
            }
            const [r, g, b, a] = Color.from(this._bgcolor);
            // The surface is configured alphaMode premultiplied, so a translucent
            // background has to be premultiplied here too or it composites too bright.
            return { r: r * a, g: g * a, b: b * a, a };
        }
    }

    const webgpuSupported = typeof navigator !== 'undefined' && !!navigator.gpu;
    if (webgpuSupported) {
        // The WebGPU canvas cannot hand out a 2D context for picking; route the
        // handler to the renderer's detached pick canvas instead.
        vegaScenegraph.CanvasHandler.prototype.context = function () {
            return this._canvas.getContext('2d') || (this._canvas._pickCanvas?.getContext('2d') ?? null);
        };
    }
    else {
        console.warn('[vega-webgpu] WebGPU is not supported in this environment; ' +
            "the 'webgpu' renderer will fall back to canvas rendering.");
    }
    vegaScenegraph.renderModule('webgpu', {
        renderer: webgpuSupported ? WebGPURenderer : vegaScenegraph.CanvasRenderer,
        handler: vegaScenegraph.CanvasHandler,
    });

    exports.BLEND_MODES = BLEND_MODES;
    exports.WebGPURenderer = WebGPURenderer;

}));
//# sourceMappingURL=vega-webgpu-renderer.js.map
