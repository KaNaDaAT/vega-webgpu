(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports, require('vega-scenegraph')) :
  typeof define === 'function' && define.amd ? define(['exports', 'vega-scenegraph'], factory) :
  (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.vegaWebGPURenderer = {}, global.vega));
})(this, (function (exports, vegaScenegraph) { 'use strict';

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

  function Symbol$1(type, size) {
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

  var parseSvgPath;
  var hasRequiredParseSvgPath;

  function requireParseSvgPath () {
  	if (hasRequiredParseSvgPath) return parseSvgPath;
  	hasRequiredParseSvgPath = 1;
  	parseSvgPath = parse;

  	/**
  	 * expected argument lengths
  	 * @type {Object}
  	 */

  	var length = {a: 7, c: 6, h: 1, l: 2, m: 2, q: 4, s: 4, t: 2, v: 1, z: 0};

  	/**
  	 * segment pattern
  	 * @type {RegExp}
  	 */

  	var segment = /([astvzqmhlc])([^astvzqmhlc]*)/ig;

  	/**
  	 * parse an svg path data string. Generates an Array
  	 * of commands where each command is an Array of the
  	 * form `[command, arg1, arg2, ...]`
  	 *
  	 * @param {String} path
  	 * @return {Array}
  	 */

  	function parse(path) {
  		var data = [];
  		path.replace(segment, function(_, command, args){
  			var type = command.toLowerCase();
  			args = parseValues(args);

  			// overloaded moveTo
  			if (type == 'm' && args.length > 2) {
  				data.push([command].concat(args.splice(0, 2)));
  				type = 'l';
  				command = command == 'm' ? 'l' : 'L';
  			}

  			while (true) {
  				if (args.length == length[type]) {
  					args.unshift(command);
  					return data.push(args)
  				}
  				if (args.length < length[type]) throw new Error('malformed path data')
  				data.push([command].concat(args.splice(0, length[type])));
  			}
  		});
  		return data
  	}

  	var number = /-?[0-9]*\.?[0-9]+(?:e[-+]?\d+)?/ig;

  	function parseValues(args) {
  		var numbers = args.match(number);
  		return numbers ? numbers.map(Number) : []
  	}
  	return parseSvgPath;
  }

  var parseSvgPathExports = requireParseSvgPath();
  var parse$1 = /*@__PURE__*/getDefaultExportFromCjs(parseSvgPathExports);

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

  var absSvgPath;
  var hasRequiredAbsSvgPath;

  function requireAbsSvgPath () {
  	if (hasRequiredAbsSvgPath) return absSvgPath;
  	hasRequiredAbsSvgPath = 1;
  	absSvgPath = absolutize;

  	/**
  	 * redefine `path` with absolute coordinates
  	 *
  	 * @param {Array} path
  	 * @return {Array}
  	 */

  	function absolutize(path){
  		var startX = 0;
  		var startY = 0;
  		var x = 0;
  		var y = 0;

  		return path.map(function(seg){
  			seg = seg.slice();
  			var type = seg[0];
  			var command = type.toUpperCase();

  			// is relative
  			if (type != command) {
  				seg[0] = command;
  				switch (type) {
  					case 'a':
  						seg[6] += x;
  						seg[7] += y;
  						break
  					case 'v':
  						seg[1] += y;
  						break
  					case 'h':
  						seg[1] += x;
  						break
  					default:
  						for (var i = 1; i < seg.length;) {
  							seg[i++] += x;
  							seg[i++] += y;
  						}
  				}
  			}

  			// update cursor state
  			switch (command) {
  				case 'Z':
  					x = startX;
  					y = startY;
  					break
  				case 'H':
  					x = seg[1];
  					break
  				case 'V':
  					y = seg[1];
  					break
  				case 'M':
  					x = startX = seg[1];
  					y = startY = seg[2];
  					break
  				default:
  					x = seg[seg.length - 2];
  					y = seg[seg.length - 1];
  			}

  			return seg
  		})
  	}
  	return absSvgPath;
  }

  var normalizeSvgPath;
  var hasRequiredNormalizeSvgPath;

  function requireNormalizeSvgPath () {
  	if (hasRequiredNormalizeSvgPath) return normalizeSvgPath;
  	hasRequiredNormalizeSvgPath = 1;
  	var π = Math.PI;
  	var _120 = radians(120);

  	normalizeSvgPath = normalize;

  	/**
  	 * describe `path` in terms of cubic bézier 
  	 * curves and move commands
  	 *
  	 * @param {Array} path
  	 * @return {Array}
  	 */

  	function normalize(path){
  		// init state
  		var prev;
  		var result = [];
  		var bezierX = 0;
  		var bezierY = 0;
  		var startX = 0;
  		var startY = 0;
  		var quadX = null;
  		var quadY = null;
  		var x = 0;
  		var y = 0;

  		for (var i = 0, len = path.length; i < len; i++) {
  			var seg = path[i];
  			var command = seg[0];
  			switch (command) {
  				case 'M':
  					startX = seg[1];
  					startY = seg[2];
  					break
  				case 'A':
  					seg = arc(x, y,seg[1],seg[2],radians(seg[3]),seg[4],seg[5],seg[6],seg[7]);
  					// split multi part
  					seg.unshift('C');
  					if (seg.length > 7) {
  						result.push(seg.splice(0, 7));
  						seg.unshift('C');
  					}
  					break
  				case 'S':
  					// default control point
  					var cx = x;
  					var cy = y;
  					if (prev == 'C' || prev == 'S') {
  						cx += cx - bezierX; // reflect the previous command's control
  						cy += cy - bezierY; // point relative to the current point
  					}
  					seg = ['C', cx, cy, seg[1], seg[2], seg[3], seg[4]];
  					break
  				case 'T':
  					if (prev == 'Q' || prev == 'T') {
  						quadX = x * 2 - quadX; // as with 'S' reflect previous control point
  						quadY = y * 2 - quadY;
  					} else {
  						quadX = x;
  						quadY = y;
  					}
  					seg = quadratic(x, y, quadX, quadY, seg[1], seg[2]);
  					break
  				case 'Q':
  					quadX = seg[1];
  					quadY = seg[2];
  					seg = quadratic(x, y, seg[1], seg[2], seg[3], seg[4]);
  					break
  				case 'L':
  					seg = line(x, y, seg[1], seg[2]);
  					break
  				case 'H':
  					seg = line(x, y, seg[1], y);
  					break
  				case 'V':
  					seg = line(x, y, x, seg[1]);
  					break
  				case 'Z':
  					seg = line(x, y, startX, startY);
  					break
  			}

  			// update state
  			prev = command;
  			x = seg[seg.length - 2];
  			y = seg[seg.length - 1];
  			if (seg.length > 4) {
  				bezierX = seg[seg.length - 4];
  				bezierY = seg[seg.length - 3];
  			} else {
  				bezierX = x;
  				bezierY = y;
  			}
  			result.push(seg);
  		}

  		return result
  	}

  	function line(x1, y1, x2, y2){
  		return ['C', x1, y1, x2, y2, x2, y2]
  	}

  	function quadratic(x1, y1, cx, cy, x2, y2){
  		return [
  			'C',
  			x1/3 + (2/3) * cx,
  			y1/3 + (2/3) * cy,
  			x2/3 + (2/3) * cx,
  			y2/3 + (2/3) * cy,
  			x2,
  			y2
  		]
  	}

  	// This function is ripped from 
  	// github.com/DmitryBaranovskiy/raphael/blob/4d97d4/raphael.js#L2216-L2304 
  	// which references w3.org/TR/SVG11/implnote.html#ArcImplementationNotes
  	// TODO: make it human readable

  	function arc(x1, y1, rx, ry, angle, large_arc_flag, sweep_flag, x2, y2, recursive) {
  		if (!recursive) {
  			var xy = rotate(x1, y1, -angle);
  			x1 = xy.x;
  			y1 = xy.y;
  			xy = rotate(x2, y2, -angle);
  			x2 = xy.x;
  			y2 = xy.y;
  			var x = (x1 - x2) / 2;
  			var y = (y1 - y2) / 2;
  			var h = (x * x) / (rx * rx) + (y * y) / (ry * ry);
  			if (h > 1) {
  				h = Math.sqrt(h);
  				rx = h * rx;
  				ry = h * ry;
  			}
  			var rx2 = rx * rx;
  			var ry2 = ry * ry;
  			var k = (large_arc_flag == sweep_flag ? -1 : 1)
  				* Math.sqrt(Math.abs((rx2 * ry2 - rx2 * y * y - ry2 * x * x) / (rx2 * y * y + ry2 * x * x)));
  			if (k == Infinity) k = 1; // neutralize
  			var cx = k * rx * y / ry + (x1 + x2) / 2;
  			var cy = k * -ry * x / rx + (y1 + y2) / 2;
  			var f1 = Math.asin(((y1 - cy) / ry).toFixed(9));
  			var f2 = Math.asin(((y2 - cy) / ry).toFixed(9));

  			f1 = x1 < cx ? π - f1 : f1;
  			f2 = x2 < cx ? π - f2 : f2;
  			if (f1 < 0) f1 = π * 2 + f1;
  			if (f2 < 0) f2 = π * 2 + f2;
  			if (sweep_flag && f1 > f2) f1 = f1 - π * 2;
  			if (!sweep_flag && f2 > f1) f2 = f2 - π * 2;
  		} else {
  			f1 = recursive[0];
  			f2 = recursive[1];
  			cx = recursive[2];
  			cy = recursive[3];
  		}
  		// greater than 120 degrees requires multiple segments
  		if (Math.abs(f2 - f1) > _120) {
  			var f2old = f2;
  			var x2old = x2;
  			var y2old = y2;
  			f2 = f1 + _120 * (sweep_flag && f2 > f1 ? 1 : -1);
  			x2 = cx + rx * Math.cos(f2);
  			y2 = cy + ry * Math.sin(f2);
  			var res = arc(x2, y2, rx, ry, angle, 0, sweep_flag, x2old, y2old, [f2, f2old, cx, cy]);
  		}
  		var t = Math.tan((f2 - f1) / 4);
  		var hx = 4 / 3 * rx * t;
  		var hy = 4 / 3 * ry * t;
  		var curve = [
  			2 * x1 - (x1 + hx * Math.sin(f1)),
  			2 * y1 - (y1 - hy * Math.cos(f1)),
  			x2 + hx * Math.sin(f2),
  			y2 - hy * Math.cos(f2),
  			x2,
  			y2
  		];
  		if (recursive) return curve
  		if (res) curve = curve.concat(res);
  		for (var i = 0; i < curve.length;) {
  			var rot = rotate(curve[i], curve[i+1], angle);
  			curve[i++] = rot.x;
  			curve[i++] = rot.y;
  		}
  		return curve
  	}

  	function rotate(x, y, rad){
  		return {
  			x: x * Math.cos(rad) - y * Math.sin(rad),
  			y: x * Math.sin(rad) + y * Math.cos(rad)
  		}
  	}

  	function radians(degress){
  		return degress * (π / 180)
  	}
  	return normalizeSvgPath;
  }

  var vec2Copy;
  var hasRequiredVec2Copy;

  function requireVec2Copy () {
  	if (hasRequiredVec2Copy) return vec2Copy;
  	hasRequiredVec2Copy = 1;
  	vec2Copy = function vec2Copy(out, a) {
  	    out[0] = a[0];
  	    out[1] = a[1];
  	    return out
  	};
  	return vec2Copy;
  }

  var svgPathContours;
  var hasRequiredSvgPathContours;

  function requireSvgPathContours () {
  	if (hasRequiredSvgPathContours) return svgPathContours;
  	hasRequiredSvgPathContours = 1;
  	var bezier = requireAdaptiveBezierCurve();
  	var abs = requireAbsSvgPath();
  	var norm = requireNormalizeSvgPath();
  	var copy = requireVec2Copy();

  	function set(out, x, y) {
  	    out[0] = x;
  	    out[1] = y;
  	    return out
  	}

  	var tmp1 = [0,0],
  	    tmp2 = [0,0],
  	    tmp3 = [0,0];

  	function bezierTo(points, scale, start, seg) {
  	    bezier(start, 
  	        set(tmp1, seg[1], seg[2]), 
  	        set(tmp2, seg[3], seg[4]),
  	        set(tmp3, seg[5], seg[6]), scale, points);
  	}

  	svgPathContours = function contours(svg, scale) {
  	    var paths = [];

  	    var points = [];
  	    var pen = [0, 0];
  	    norm(abs(svg)).forEach(function(segment, i, self) {
  	        if (segment[0] === 'M') {
  	            copy(pen, segment.slice(1));
  	            if (points.length>0) {
  	                paths.push(points);
  	                points = [];
  	            }
  	        } else if (segment[0] === 'C') {
  	            bezierTo(points, scale, pen, segment);
  	            set(pen, segment[5], segment[6]);
  	        } else {
  	            throw new Error('illegal type in SVG: '+segment[0])
  	        }
  	    });
  	    if (points.length>0)
  	        paths.push(points);
  	    return paths
  	};
  	return svgPathContours;
  }

  var svgPathContoursExports = requireSvgPathContours();
  var contours = /*@__PURE__*/getDefaultExportFromCjs(svgPathContoursExports);

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

  const EMPTY = { lines: [], triangles: [], closed: false, z: 0 };
  /**
   * Triangulates an SVG path string into fill triangles and outline contours.
   * Results are cached on the context, keyed by the path string.
   */
  function geometryForPath(context, path, threshold = 1.0) {
      if (!path) {
          return EMPTY;
      }
      const cacheKey = `${threshold}|${path}`;
      const cached = context._pathCache[cacheKey];
      if (cached !== undefined) {
          return cached;
      }
      // get a list of polylines/contours from svg contents
      const lines = contours(parse$1(path)).map(contour => simplify(contour, threshold));
      // triangulation can fail in some corner cases
      let tri;
      try {
          tri = triangulate(lines);
      }
      catch {
          tri = { positions: [], cells: [] };
      }
      const z = context._randomZ ? 0.25 * (Math.random() - 0.5) : 0;
      const triangles = [];
      const { cells, positions } = tri;
      for (let ci = 0; ci < cells.length; ci++) {
          const cell = cells[ci];
          const p1 = positions[cell[0]];
          const p2 = positions[cell[1]];
          const p3 = positions[cell[2]];
          triangles.push(p1[0], p1[1], z, p2[0], p2[1], z, p3[0], p3[1], z);
      }
      const geom = {
          lines,
          triangles,
          closed: /z\s*$/i.test(path),
          z,
          key: path,
      };
      context._pathCache[cacheKey] = geom;
      context._pathCacheSize++;
      if (context._pathCacheSize > 10000) {
          context._pathCache = {};
          context._pathCacheSize = 0;
      }
      return geom;
  }

  const x = (item) => item.x || 0;
  const y = (item) => item.y || 0;
  const xw = (item) => (item.x || 0) + (item.width || 0);
  const yh = (item) => (item.y || 0) + (item.height || 0);
  const wh = (item) => item.width || item.height || 1;
  const cr = (item) => item.cornerRadius || 0;
  const pa = (item) => item.padAngle || 0;
  const def = (item) => item.defined !== false;
  const arcShape = d3_arc().cornerRadius(cr).padAngle(pa);
  const areavShape = d3_area().x(x).y1(y).y0(yh).defined(def);
  const areahShape = d3_area().y(y).x1(x).x0(xw).defined(def);
  const trailShape = vegaScenegraph.pathTrail().x(x).y(y).defined(def).size(wh);
  const lineShape = d3_line().x(x).y(y).defined(def);
  function arc$1(context, item) {
      return geometryForPath(context, arcShape.context(null)(item) ?? '', 0.1);
  }
  function area$1(context, items) {
      const item = items[0];
      const interp = item.interpolate || 'linear';
      const path = interp === 'trail'
          ? trailShape.context(null)(items)
          : (item.orient === 'horizontal' ? areahShape : areavShape)
              .curve(vegaScenegraph.pathCurves(interp, item.orient, item.tension))
              .context(null)(items);
      return geometryForPath(context, path ?? '', 0.1);
  }
  /**
   * Path geometry for a line mark, honouring `interpolate`, `tension` and the
   * `defined` gaps. Used when the line is not a plain polyline.
   */
  function line$1(context, items) {
      const item = items[0];
      const curve = vegaScenegraph.pathCurves(item.interpolate || 'linear', item.orient, item.tension);
      return geometryForPath(context, lineShape.curve(curve).context(null)(items) ?? '', 0.1);
  }
  function shape$1(context, item) {
      const generator = (item.mark.shape ?? item.shape);
      return geometryForPath(context, generator.context(null)(item) ?? '', 0.1);
  }
  /**
   * Triangulated geometry for a vega symbol shape (square, cross, diamond,
   * triangle-*, arrow, wedge, stroke, or a custom SVG path) at the given size,
   * centered on the origin. `size` is the symbol area, matching the canvas
   * renderer's `pathSymbols` sizing.
   */
  function symbol$1(context, shapeName, size) {
      const type = vegaScenegraph.pathSymbols(shapeName || 'circle');
      const path = Symbol$1(type, size).context(null)() ?? '';
      return geometryForPath(context, path, 0.1);
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
   * Converts triangulated path geometry into per-item fill and stroke
   * triangle buffers. `dx`/`dy` apply an item-local translation (e.g. the
   * x/y of a path mark item). Group translation is handled by the render
   * offset uniform and must NOT be baked in here.
   */
  function geometryForItem(context, item, shapeGeom, cache = false, dx = 0, dy = 0) {
      const key = shapeGeom.key;
      if (cache && key !== undefined) {
          const entry = context._geometryCache[key];
          if (entry) {
              return entry;
          }
      }
      const lineWidth = item.strokeWidth ?? 1;
      const lineCap = item.strokeCap ?? 'butt';
      const opacity = item.opacity ?? 1;
      let fillOpacity = opacity * (item.fillOpacity ?? 1);
      let strokeOpacity = opacity * (item.strokeOpacity ?? 1);
      const fillTriangleCoords = shapeGeom.triangles;
      let z = shapeGeom.z;
      if (item.fill === 'transparent') {
          fillOpacity = 0;
      }
      const fill = Boolean(item.fill) && fillOpacity > 0;
      const fillVertexCount = fill ? fillTriangleCoords.length / 3 : 0;
      if (item.stroke === 'transparent') {
          strokeOpacity = 0;
      }
      const strokeMeshes = [];
      let strokeCellCount = 0;
      if (lineWidth > 0 && item.stroke && strokeOpacity > 0) {
          const strokeExtrude = extrude({
              thickness: lineWidth,
              cap: lineCap,
              join: 'miter',
              // canvas defaults to 10; at 1 almost every corner is bevel-cut
              miterLimit: 10,
              closed: shapeGeom.closed,
          });
          for (const line of shapeGeom.lines) {
              const mesh = strokeExtrude.build(line);
              strokeMeshes.push(mesh);
              strokeCellCount += mesh.cells.length;
          }
      }
      const triangles = new Float32Array(fillVertexCount * 3);
      const strokeTriangles = new Float32Array(strokeCellCount * 3 * 3);
      if (fill) {
          for (let i = 0; i < fillTriangleCoords.length; i += 3) {
              triangles[i] = fillTriangleCoords[i] + dx;
              triangles[i + 1] = fillTriangleCoords[i + 1] + dy;
              triangles[i + 2] = fillTriangleCoords[i + 2];
          }
      }
      if (strokeMeshes.length > 0) {
          // strokes render slightly in front of fills
          z = -0.1;
          let i = 0;
          for (const mesh of strokeMeshes) {
              const { positions, cells } = mesh;
              for (const cell of cells) {
                  for (const pointIndex of cell) {
                      const p = positions[pointIndex];
                      strokeTriangles[i * 3] = p[0] + dx;
                      strokeTriangles[i * 3 + 1] = p[1] + dy;
                      strokeTriangles[i * 3 + 2] = z;
                      i++;
                  }
              }
          }
      }
      const result = {
          fillTriangles: triangles,
          strokeTriangles,
          fillCount: fillVertexCount,
          strokeCount: strokeCellCount * 3,
      };
      if (cache && key !== undefined) {
          context._geometryCache[key] = result;
          context._geometryCacheSize++;
          if (context._geometryCacheSize > 10000) {
              context._geometryCache = {};
              context._geometryCacheSize = 0;
          }
      }
      return result;
  }

  class BufferManager {
      device;
      bufferName;
      resolution;
      offset;
      constructor(device, bufferName = 'Unknown', resolution = [0, 0], offset = [0, 0]) {
          this.device = device;
          this.bufferName = bufferName;
          this.resolution = resolution;
          this.offset = offset;
      }
      createUniformBuffer(data, usage = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST) {
          const values = data ?? new Float32Array([...this.resolution, ...this.offset]);
          return this.createBuffer(`${this.bufferName} Uniform Buffer`, values, usage);
      }
      createGeometryBuffer(data, usage = GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST) {
          return this.createBuffer(`${this.bufferName} Geometry Buffer`, data, usage);
      }
      createInstanceBuffer(data, usage = GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST) {
          return this.createBuffer(`${this.bufferName} Instance Buffer`, data, usage);
      }
      // source: https://alain.xyz/blog/raw-webgpu
      createBuffer(name, data, usage) {
          const buffer = this.device.createBuffer({
              label: name,
              size: (data.byteLength + 3) & -4,
              usage,
              mappedAtCreation: true,
          });
          if (data instanceof Uint16Array) {
              new Uint16Array(buffer.getMappedRange()).set(data);
          }
          else if (data instanceof Uint32Array) {
              new Uint32Array(buffer.getMappedRange()).set(data);
          }
          else {
              new Float32Array(buffer.getMappedRange()).set(data);
          }
          buffer.unmap();
          return buffer;
      }
      getDevice() {
          return this.device;
      }
      getBufferName() {
          return this.bufferName;
      }
      getResolution() {
          return this.resolution;
      }
      getOffset() {
          return this.offset;
      }
      setResolution(resolution) {
          this.resolution = resolution;
      }
      setOffset(offset) {
          this.offset = offset;
      }
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
  /** Placeholder for gradients on paths that cannot sample a ramp (strokes). */
  const GRADIENT_FALLBACK = [0.5, 1.0, 1.0, 1.0];
  let warnedGradient = false;
  let warnedInvalid = false;
  function isGradient(value) {
      return typeof value === 'object' && value !== null && ('gradient' in value || 'id' in value);
  }
  /** Parses a CSS color string to premultiplication-ready normalized RGBA. */
  function parse(value) {
      const c = color(value);
      if (c === null) {
          if (!warnedInvalid) {
              warnedInvalid = true;
              console.warn(`[vega-webgpu] Could not parse color '${value}'.`);
          }
          return TRANSPARENT;
      }
      const rgb = c.rgb();
      return [rgb.r / 255, rgb.g / 255, rgb.b / 255, rgb.opacity];
  }
  class Color {
      static cache = {};
      values;
      constructor(r, g, b, a = 1) {
          this.values = [r, g, b, a];
      }
      /**
       * Converts a scenegraph color value into a Color, applying the item's
       * opacity and fill/stroke opacity. Unset values become transparent.
       */
      static from(value, opacity = 1.0, fsOpacity = 1.0) {
          const [r, g, b, a] = Color.from2(value, opacity, fsOpacity);
          return new Color(r, g, b, a);
      }
      /**
       * Same as `from`, returning a plain RGBA tuple. Parses through a cache
       * keyed by the color string. Opacity is applied after cache lookup.
       */
      static from2(value, opacity = 1.0, fsOpacity = 1.0) {
          if (value == null) {
              return TRANSPARENT;
          }
          if (value instanceof Color) {
              return [value.r, value.g, value.b, value.a];
          }
          if (value === 'transparent') {
              return TRANSPARENT;
          }
          if (isGradient(value)) {
              if (!warnedGradient) {
                  warnedGradient = true;
                  console.warn('[vega-webgpu] Gradient strokes are not supported, drawing a placeholder color.');
              }
              const [r, g, b, a] = GRADIENT_FALLBACK;
              return [r, g, b, a * opacity * fsOpacity];
          }
          let rgba = Color.cache[value];
          if (rgba === undefined) {
              rgba = parse(value);
              Color.cache[value] = rgba;
          }
          return [rgba[0], rgba[1], rgba[2], rgba[3] * opacity * fsOpacity];
      }
      *[Symbol.iterator]() {
          yield* this.values;
      }
      get rgba() {
          return [this.values[0], this.values[1], this.values[2], this.values[3]];
      }
      get r() {
          return this.values[0];
      }
      get g() {
          return this.values[1];
      }
      get b() {
          return this.values[2];
      }
      get a() {
          return this.values[3];
      }
      get 0() {
          return this.values[0];
      }
      get 1() {
          return this.values[1];
      }
      get 2() {
          return this.values[2];
      }
      get 3() {
          return this.values[3];
      }
  }

  /**
   * Returns the GPU resources for a mark type, creating them on first use
   * or after a device change. Resources live on the canvas context, so each
   * renderer instance keeps its own set.
   */
  function getMarkResources(ctx, markType, device, create) {
      const cached = ctx._markCache[markType];
      if (cached && cached.device === device) {
          return cached;
      }
      const created = create();
      ctx._markCache[markType] = created;
      return created;
  }
  /**
   * Interleaves triangulated fill and stroke geometry with their colors
   * into [x, y, z, r, g, b, a] vertex buffers.
   */
  function geometryVertexData(geometry, fill, stroke) {
      const fillData = new Float32Array(geometry.fillCount * 7);
      const strokeData = new Float32Array(geometry.strokeCount * 7);
      for (let i = 0; i < geometry.fillCount; i++) {
          fillData[i * 7] = geometry.fillTriangles[i * 3];
          fillData[i * 7 + 1] = geometry.fillTriangles[i * 3 + 1];
          fillData[i * 7 + 2] = geometry.fillTriangles[i * 3 + 2] * -1;
          fillData[i * 7 + 3] = fill[0];
          fillData[i * 7 + 4] = fill[1];
          fillData[i * 7 + 5] = fill[2];
          fillData[i * 7 + 6] = fill[3];
      }
      for (let i = 0; i < geometry.strokeCount; i++) {
          strokeData[i * 7] = geometry.strokeTriangles[i * 3];
          strokeData[i * 7 + 1] = geometry.strokeTriangles[i * 3 + 1];
          strokeData[i * 7 + 2] = geometry.strokeTriangles[i * 3 + 2] * -1;
          strokeData[i * 7 + 3] = stroke[0];
          strokeData[i * 7 + 4] = stroke[1];
          strokeData[i * 7 + 5] = stroke[2];
          strokeData[i * 7 + 6] = stroke[3];
      }
      return [fillData, strokeData];
  }
  /**
   * Scissor rect for a mark, in physical pixels. Marks with `clip: true`
   * are clipped to their enclosing group. Otherwise the inherited group
   * clip (if any) applies.
   */
  function markClip(ctx, scene) {
      if (!scene.clip) {
          return ctx._clip;
      }
      const group = scene.group;
      if (!group) {
          return ctx._clip;
      }
      const dpi = ctx._uniforms.dpi;
      return [
          (ctx._origin[0] + ctx._tx) * dpi,
          (ctx._origin[1] + ctx._ty) * dpi,
          (group.width || 0) * dpi,
          (group.height || 0) * dpi,
      ];
  }
  /**
   * An item's bounding box in the same coordinate space as its triangulated
   * vertices (group translation applied), as [x, y, w, h] for gradients.
   */
  function gradientBounds(ctx, bounds) {
      return [bounds.x1 + ctx._tx, bounds.y1 + ctx._ty, Math.max(bounds.width(), 1e-6), Math.max(bounds.height(), 1e-6)];
  }
  /** Fill color for vertex data: white carrier with opacity when a gradient is used. */
  function whiteCarrier(opacity = 1, fillOpacity = 1) {
      return [1, 1, 1, opacity * fillOpacity];
  }
  /**
   * Accumulates the vertex data of consecutive items that share one pipeline
   * so a whole mark renders as a single buffer and draw call. Data is appended
   * in paint order (fill then stroke, item by item), preserving canvas
   * rendering semantics for overlapping items.
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
      /** Concatenated data, or null when nothing was pushed. Resets the batch. */
      flush() {
          if (this.total === 0) {
              return null;
          }
          const out = new Float32Array(this.total);
          let offset = 0;
          for (const chunk of this.chunks) {
              out.set(chunk, offset);
              offset += chunk.length;
          }
          this.chunks = [];
          this.total = 0;
          return out;
      }
  }

  /** Texels in a baked gradient stop ramp. */
  const RAMP_SIZE = 256;
  function getGradientResources(device, ctx) {
      return getMarkResources(ctx, '__gradient', device, () => ({
          device,
          sampler: device.createSampler({
              label: 'Gradient Sampler',
              magFilter: 'linear',
              minFilter: 'linear',
              addressModeU: 'clamp-to-edge',
              addressModeV: 'clamp-to-edge',
          }),
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
          const c = color(s.color)?.rgb();
          return {
              offset: Math.min(Math.max(s.offset, 0), 1),
              r: c ? c.r : 0,
              g: c ? c.g : 0,
              b: c ? c.b : 0,
              a: c ? c.opacity : 1,
          };
      })
          .sort((a, b) => a.offset - b.offset);
      if (stops.length === 0) {
          stops.push({ offset: 0, r: 0, g: 0, b: 0, a: 1 });
      }
      const data = new Uint8Array(RAMP_SIZE * 4);
      for (let i = 0; i < RAMP_SIZE; i++) {
          const t = i / (RAMP_SIZE - 1);
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
   * Radial gradients use the concentric-circle approximation around (x2, y2).
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
      const paramsBuffer = res.device.createBuffer({
          label: 'Gradient Params',
          size: 48,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      res.device.queue.writeBuffer(paramsBuffer, 0, gradientParams(gradient, bounds));
      return res.device.createBindGroup({
          label: 'Gradient Bind Group',
          layout: pipeline.getBindGroupLayout(1),
          entries: [
              { binding: 0, resource: res.sampler },
              { binding: 1, resource: getStopRamp(res, gradient).createView() },
              { binding: 2, resource: { buffer: paramsBuffer } },
          ],
      });
  }

  function formatElementCount(format) {
      switch (format) {
          case 'float32':
          case 'uint32':
          case 'sint32':
              return 1;
          case 'uint8x2':
          case 'sint8x2':
          case 'unorm8x2':
          case 'snorm8x2':
          case 'uint16x2':
          case 'sint16x2':
          case 'unorm16x2':
          case 'snorm16x2':
          case 'float16x2':
          case 'float32x2':
          case 'uint32x2':
          case 'sint32x2':
              return 2;
          case 'float32x3':
          case 'uint32x3':
          case 'sint32x3':
              return 3;
          case 'uint8x4':
          case 'sint8x4':
          case 'unorm8x4':
          case 'snorm8x4':
          case 'uint16x4':
          case 'sint16x4':
          case 'unorm16x4':
          case 'snorm16x4':
          case 'float16x4':
          case 'float32x4':
          case 'uint32x4':
          case 'sint32x4':
              return 4;
          default:
              return 0; // Unsupported format
      }
  }
  function formatSize(format) {
      switch (format) {
          case 'float16x2':
              return 2 * 2;
          case 'float16x4':
              return 2 * 4;
          case 'float32':
              return Float32Array.BYTES_PER_ELEMENT;
          case 'float32x2':
              return Float32Array.BYTES_PER_ELEMENT * 2;
          case 'float32x3':
              return Float32Array.BYTES_PER_ELEMENT * 3;
          case 'float32x4':
              return Float32Array.BYTES_PER_ELEMENT * 4;
          case 'sint8x2':
          case 'snorm8x2':
              return Int8Array.BYTES_PER_ELEMENT * 2;
          case 'sint8x4':
          case 'snorm8x4':
              return Int8Array.BYTES_PER_ELEMENT * 4;
          case 'sint16x2':
          case 'snorm16x2':
              return Int16Array.BYTES_PER_ELEMENT * 2;
          case 'sint16x4':
          case 'snorm16x4':
              return Int16Array.BYTES_PER_ELEMENT * 4;
          case 'sint32':
              return Int32Array.BYTES_PER_ELEMENT;
          case 'sint32x2':
              return Int32Array.BYTES_PER_ELEMENT * 2;
          case 'sint32x3':
              return Int32Array.BYTES_PER_ELEMENT * 3;
          case 'sint32x4':
              return Int32Array.BYTES_PER_ELEMENT * 4;
          case 'uint32':
              return Uint32Array.BYTES_PER_ELEMENT;
          case 'uint32x2':
              return Uint32Array.BYTES_PER_ELEMENT * 2;
          case 'uint32x3':
              return Uint32Array.BYTES_PER_ELEMENT * 3;
          case 'uint32x4':
              return Uint32Array.BYTES_PER_ELEMENT * 4;
          case 'uint8x2':
          case 'unorm8x2':
              return Uint8Array.BYTES_PER_ELEMENT * 2;
          case 'uint8x4':
          case 'unorm8x4':
              return Uint8Array.BYTES_PER_ELEMENT * 4;
          case 'uint16x2':
          case 'unorm16x2':
              return Uint16Array.BYTES_PER_ELEMENT * 2;
          case 'uint16x4':
          case 'unorm16x4':
              return Uint16Array.BYTES_PER_ELEMENT * 4;
          case 'unorm10-10-10-2':
              return 4; // (10 + 10 + 10 + 2) / 8
          default:
              return 0;
      }
  }

  /**
   * Derives GPUVertexBufferLayouts (one per-vertex, one per-instance) from
   * lists of vertex formats, assigning consecutive shader locations.
   */
  class VertexBufferManager {
      vertexFormats;
      instanceFormats;
      vertexLocationOffset;
      instanceLocationOffset;
      vertexLayout = null;
      instanceLayout = null;
      vertexLength = 0;
      instanceLength = 0;
      dirty = true;
      constructor(vertexFormats = [], instanceFormats = [], vertexLocationOffset = 0, instanceLocationOffset) {
          this.vertexFormats = vertexFormats;
          this.instanceFormats = instanceFormats;
          this.vertexLocationOffset = vertexLocationOffset;
          this.instanceLocationOffset = instanceLocationOffset ?? vertexLocationOffset + vertexFormats.length;
      }
      calculateLayout(stepMode) {
          const formats = stepMode === 'vertex' ? this.vertexFormats : this.instanceFormats;
          const locationOffset = stepMode === 'vertex' ? this.vertexLocationOffset : this.instanceLocationOffset;
          const attributes = [];
          let totalOffset = 0;
          formats.forEach((format, index) => {
              const size = formatSize(format);
              if (size > 0) {
                  attributes.push({
                      shaderLocation: index + locationOffset,
                      offset: totalOffset,
                      format,
                  });
                  totalOffset += size;
              }
              else {
                  console.error(`[vega-webgpu] Unsupported vertex format: ${format}`);
              }
          });
          return {
              arrayStride: totalOffset,
              stepMode,
              attributes,
          };
      }
      calculateLength(stepMode) {
          const formats = stepMode === 'vertex' ? this.vertexFormats : this.instanceFormats;
          return formats.reduce((total, format) => total + formatElementCount(format), 0);
      }
      process() {
          if (this.dirty) {
              this.vertexLayout = this.calculateLayout('vertex');
              this.instanceLayout = this.calculateLayout('instance');
              this.vertexLength = this.calculateLength('vertex');
              this.instanceLength = this.calculateLength('instance');
              this.dirty = false;
          }
      }
      pushFormats(stepMode, formats) {
          const target = stepMode === 'vertex' ? this.vertexFormats : this.instanceFormats;
          target.push(...formats);
          this.dirty = true;
      }
      clear() {
          this.vertexFormats = [];
          this.instanceFormats = [];
          this.dirty = true;
      }
      /** Layouts for pipeline creation; empty layouts are omitted. */
      getBuffers() {
          this.process();
          const buffers = [];
          if (this.vertexLength > 0 && this.vertexLayout) {
              buffers.push(this.vertexLayout);
          }
          if (this.instanceLength > 0 && this.instanceLayout) {
              buffers.push(this.instanceLayout);
          }
          return buffers;
      }
      /** Number of float elements per vertex. */
      getVertexLength() {
          this.process();
          return this.vertexLength;
      }
      /** Number of float elements per instance. */
      getInstanceLength() {
          this.process();
          return this.instanceLength;
      }
  }

  /** Factory helpers for the WebGPU objects shared by all mark renderers. */
  /**
   * By default rendering goes through a 4x multisampled attachment (guaranteed
   * to be supported by WebGPU) that is resolved into the canvas, so geometric
   * edges of triangulated marks get antialiased without per-shader work.
   * `wgOptions.sampleCount = 1` renders directly into the canvas instead.
   */
  const defaultSampleCount = 4;
  let warnedSampleCount = false;
  /** WebGPU render attachments only support 1 or 4 samples portably. */
  function normalizeSampleCount(value) {
      if (value === 1 || value === 4) {
          return value;
      }
      if (!warnedSampleCount) {
          warnedSampleCount = true;
          console.warn(`[vega-webgpu] Unsupported sampleCount ${value}; only 1 or 4 are supported. Using ${defaultSampleCount}.`);
      }
      return defaultSampleCount;
  }
  function preferredColorFormat() {
      return typeof navigator !== 'undefined' && navigator.gpu ? navigator.gpu.getPreferredCanvasFormat() : 'bgra8unorm';
  }
  function createRenderPipeline(name, device, shader, format, sampleCount, buffers, layout, fragmentEntryPoint = 'main_fragment') {
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
              targets: [
                  {
                      format,
                      blend: {
                          alpha: {
                              srcFactor: 'one',
                              dstFactor: 'one-minus-src-alpha',
                              operation: 'add',
                          },
                          color: {
                              srcFactor: 'src-alpha',
                              dstFactor: 'one-minus-src-alpha',
                              operation: 'add',
                          },
                      },
                  },
              ],
          },
          primitive: {
              topology: 'triangle-list',
          },
          multisample: {
              count: normalizeSampleCount(sampleCount),
          },
      });
  }
  function createUniformBindGroup(name, device, pipeline, uniforms, binding = 0) {
      return device.createBindGroup({
          label: `${name} Uniform Bind Group`,
          layout: pipeline.getBindGroupLayout(binding),
          entries: [
              {
                  binding,
                  resource: {
                      buffer: uniforms,
                  },
              },
          ],
      });
  }
  /**
   * The frame renders in a single pass: the color attachment is cleared to the
   * view background on load, drawn in scenegraph order (painter's algorithm,
   * there is no depth attachment), and resolved once when multisampled.
   */
  function createRenderPassDescriptor(name, clearColor) {
      return {
          label: `${name} Render Pass Descriptor`,
          colorAttachments: [
              {
                  // Views are assigned by the renderer before submission.
                  view: undefined,
                  resolveTarget: undefined,
                  clearValue: clearColor,
                  loadOp: 'clear',
                  storeOp: 'store',
              },
          ],
      };
  }

  const drawName$a = 'Arc';
  function getResources$a(device, ctx, vb) {
      return getMarkResources(ctx, 'arc', device, () => {
          const bufferManager = new BufferManager(device, drawName$a, ctx._uniforms.resolution, [vb.x1, vb.y1]);
          const vertexManager = new VertexBufferManager(['float32x3', 'float32x4'], // position, color
          []);
          const pipeline = createRenderPipeline(drawName$a, device, ctx._shaderCache['Path'], preferredColorFormat(), ctx._sampleCount, vertexManager.getBuffers());
          const gradientPipeline = createRenderPipeline(`${drawName$a}Gradient`, device, ctx._shaderCache['GradientFill'], preferredColorFormat(), ctx._sampleCount, vertexManager.getBuffers());
          return { device, bufferManager, vertexManager, pipeline, gradientPipeline };
      });
  }
  function draw$a(device, ctx, scene, vb) {
      const items = scene.items;
      if (!items?.length) {
          return;
      }
      const res = getResources$a(device, ctx, vb);
      res.bufferManager.setResolution(ctx._uniforms.resolution);
      res.bufferManager.setOffset([vb.x1, vb.y1]);
      const uniformBuffer = res.bufferManager.createUniformBuffer();
      const clip = markClip(ctx, scene);
      const vertexLength = res.vertexManager.getVertexLength();
      // Solid fills and strokes share one pipeline and are accumulated in paint
      // order into a single buffer/draw. Gradient fills interrupt the batch.
      const batch = new GeometryBatch();
      const flushBatch = () => {
          const data = batch.flush();
          if (data) {
              ctx._renderQueue.enqueue({
                  pipeline: res.pipeline,
                  drawCounts: [data.length / vertexLength],
                  vertexBuffers: [res.bufferManager.createGeometryBuffer(data)],
                  bindGroups: [createUniformBindGroup(drawName$a, device, res.pipeline, uniformBuffer)],
                  clip,
              });
          }
      };
      for (const item of items) {
          const bounds = item.bounds;
          const gradient = isGradient(item.fill) && bounds ? item.fill : null;
          const fill = gradient
              ? whiteCarrier(item.opacity, item.fillOpacity)
              : Color.from2(item.fill, item.opacity, item.fillOpacity);
          const stroke = Color.from2(item.stroke, item.opacity, item.strokeOpacity);
          const shapeGeom = arc$1(ctx, item);
          // arc paths are generated around the origin, so bake the item center in
          const geometry = geometryForItem(ctx, item, shapeGeom, false, item.x ?? 0, item.y ?? 0);
          const [fillData, strokeData] = geometryVertexData(geometry, fill, stroke);
          if (fillData.length > 0 && gradient && bounds) {
              flushBatch();
              const gres = getGradientResources(device, ctx);
              ctx._renderQueue.enqueue({
                  pipeline: res.gradientPipeline,
                  drawCounts: [fillData.length / vertexLength],
                  vertexBuffers: [res.bufferManager.createGeometryBuffer(fillData)],
                  bindGroups: [
                      createUniformBindGroup(`${drawName$a}Gradient`, device, res.gradientPipeline, uniformBuffer),
                      createGradientBindGroup(gres, res.gradientPipeline, gradient, gradientBounds(ctx, bounds)),
                  ],
                  clip,
              });
          }
          else {
              batch.push(fillData);
          }
          batch.push(strokeData);
      }
      flushBatch();
  }
  var arc = {
      type: 'arc',
      draw: draw$a,
  };

  const drawName$9 = 'Area';
  function getResources$9(device, ctx, vb) {
      return getMarkResources(ctx, 'area', device, () => {
          const bufferManager = new BufferManager(device, drawName$9, ctx._uniforms.resolution, [vb.x1, vb.y1]);
          const vertexManager = new VertexBufferManager(['float32x3', 'float32x4'], // position, color
          []);
          const pipeline = createRenderPipeline(drawName$9, device, ctx._shaderCache[drawName$9], preferredColorFormat(), ctx._sampleCount, vertexManager.getBuffers());
          const gradientPipeline = createRenderPipeline(`${drawName$9}Gradient`, device, ctx._shaderCache['GradientFill'], preferredColorFormat(), ctx._sampleCount, vertexManager.getBuffers());
          return { device, bufferManager, vertexManager, pipeline, gradientPipeline };
      });
  }
  function draw$9(device, ctx, scene, vb) {
      const items = scene.items;
      if (!items?.length) {
          return;
      }
      const res = getResources$9(device, ctx, vb);
      res.bufferManager.setResolution(ctx._uniforms.resolution);
      res.bufferManager.setOffset([vb.x1, vb.y1]);
      // An area mark renders all its items as one shape.
      const item = items[0];
      const bounds = scene.bounds ?? item.bounds;
      const gradient = isGradient(item.fill) && bounds ? item.fill : null;
      const fill = gradient
          ? whiteCarrier(item.opacity, item.fillOpacity)
          : Color.from2(item.fill, item.opacity, item.fillOpacity);
      const stroke = Color.from2(item.stroke, item.opacity, item.strokeOpacity);
      const shapeGeom = area$1(ctx, items);
      const geometry = geometryForItem(ctx, item, shapeGeom);
      const [fillData, strokeData] = geometryVertexData(geometry, fill, stroke);
      const uniformBuffer = res.bufferManager.createUniformBuffer();
      const clip = markClip(ctx, scene);
      const vertexLength = res.vertexManager.getVertexLength();
      if (fillData.length > 0) {
          if (gradient && bounds) {
              const gres = getGradientResources(device, ctx);
              ctx._renderQueue.enqueue({
                  pipeline: res.gradientPipeline,
                  drawCounts: [fillData.length / vertexLength],
                  vertexBuffers: [res.bufferManager.createGeometryBuffer(fillData)],
                  bindGroups: [
                      createUniformBindGroup(`${drawName$9}Gradient`, device, res.gradientPipeline, uniformBuffer),
                      createGradientBindGroup(gres, res.gradientPipeline, gradient, gradientBounds(ctx, bounds)),
                  ],
                  clip,
              });
          }
          else {
              ctx._renderQueue.enqueue({
                  pipeline: res.pipeline,
                  drawCounts: [fillData.length / vertexLength],
                  vertexBuffers: [res.bufferManager.createGeometryBuffer(fillData)],
                  bindGroups: [createUniformBindGroup(drawName$9, device, res.pipeline, uniformBuffer)],
                  clip,
              });
          }
      }
      if (strokeData.length > 0) {
          ctx._renderQueue.enqueue({
              pipeline: res.pipeline,
              drawCounts: [strokeData.length / vertexLength],
              vertexBuffers: [res.bufferManager.createGeometryBuffer(strokeData)],
              bindGroups: [createUniformBindGroup(drawName$9, device, res.pipeline, uniformBuffer)],
              clip,
          });
      }
  }
  var area = {
      type: 'area',
      draw: draw$9,
  };

  /** Two-triangle unit quad, as [x, y] pairs. */
  const quadVertex = Float32Array.from([0, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 1]);

  function compare(a, b) {
      return (a.zindex ?? 0) - (b.zindex ?? 0) || (a.index ?? 0) - (b.index ?? 0);
  }
  function zorder(scene) {
      if (!scene.zdirty) {
          return scene.zitems;
      }
      const items = scene.items ?? [];
      const output = [];
      for (let i = 0; i < items.length; i++) {
          const item = items[i];
          item.index = i;
          if (item.zindex) {
              output.push(item);
          }
      }
      scene.zdirty = false;
      return (scene.zitems = output.sort(compare));
  }
  /** Visits scene items in paint order, honoring per-item zindex. */
  function visit(scene, visitor) {
      let items = scene.items;
      if (!items || !items.length) {
          return;
      }
      const zitems = zorder(scene);
      if (zitems && zitems.length) {
          for (let i = 0; i < items.length; i++) {
              if (!items[i].zindex) {
                  visitor(items[i]);
              }
          }
          items = zitems;
      }
      for (let i = 0; i < items.length; i++) {
          visitor(items[i]);
      }
  }

  const drawName$8 = 'Rect';
  function getResources$8(device, ctx, vb) {
      return getMarkResources(ctx, 'rect', device, () => {
          const bufferManager = new BufferManager(device, drawName$8, ctx._uniforms.resolution, [vb.x1, vb.y1]);
          const vertexManager = new VertexBufferManager(['float32x2'], // position
          // center, dimensions, fill color, stroke color, stroke width, corner radii
          ['float32x2', 'float32x2', 'float32x4', 'float32x4', 'float32', 'float32x4']);
          const pipeline = createRenderPipeline(drawName$8, device, ctx._shaderCache[drawName$8], preferredColorFormat(), ctx._sampleCount, vertexManager.getBuffers());
          const gradientPipeline = createRenderPipeline(`${drawName$8}Gradient`, device, ctx._shaderCache[drawName$8], preferredColorFormat(), ctx._sampleCount, vertexManager.getBuffers(), undefined, 'main_fragment_gradient');
          const geometryBuffer = bufferManager.createGeometryBuffer(quadVertex);
          return { device, bufferManager, vertexManager, pipeline, gradientPipeline, geometryBuffer };
      });
  }
  function draw$8(device, ctx, scene, vb) {
      const items = scene.items;
      if (!items?.length) {
          return;
      }
      const res = getResources$8(device, ctx, vb);
      res.bufferManager.setResolution(ctx._uniforms.resolution);
      res.bufferManager.setOffset([vb.x1, vb.y1]);
      const uniformBuffer = res.bufferManager.createUniformBuffer();
      const clip = markClip(ctx, scene);
      const gres = getGradientResources(device, ctx);
      let run = [];
      const flushRun = () => {
          if (run.length === 0) {
              return;
          }
          const instanceBuffer = res.bufferManager.createInstanceBuffer(rectAttributes(run));
          ctx._renderQueue.enqueue({
              pipeline: res.pipeline,
              drawCounts: [6, run.length],
              vertexBuffers: [res.geometryBuffer, instanceBuffer],
              bindGroups: [createUniformBindGroup(drawName$8, device, res.pipeline, uniformBuffer)],
              clip,
          });
          run = [];
      };
      for (const item of items) {
          const fill = item.fill;
          if (!isGradient(fill)) {
              run.push(item);
              continue;
          }
          flushRun();
          const instanceBuffer = res.bufferManager.createInstanceBuffer(rectAttributes([item], true));
          ctx._renderQueue.enqueue({
              pipeline: res.gradientPipeline,
              drawCounts: [6, 1],
              vertexBuffers: [res.geometryBuffer, instanceBuffer],
              bindGroups: [
                  createUniformBindGroup(`${drawName$8}Gradient`, device, res.gradientPipeline, uniformBuffer),
                  // rect gradients evaluate in uv space, bounds are the unit square
                  createGradientBindGroup(gres, res.gradientPipeline, fill, [0, 0, 1, 1]),
              ],
              clip,
          });
      }
      flushRun();
  }
  function rectAttributes(items, whiteGradientFill = false) {
      return Float32Array.from(items.flatMap(rect => {
          const { x = 0, y = 0, width = 0, height = 0, opacity = 1, fill, fillOpacity = 1, stroke, strokeOpacity = 1, strokeWidth, cornerRadius = 0, cornerRadiusBottomLeft, cornerRadiusBottomRight, cornerRadiusTopRight, cornerRadiusTopLeft, } = rect;
          const col = whiteGradientFill && isGradient(fill)
              ? whiteCarrier(opacity, fillOpacity)
              : Color.from2(fill, opacity, fillOpacity);
          const scol = Color.from2(stroke, opacity, strokeOpacity);
          // Only reserve stroke width when a stroke is actually painted. Vega marks
          // may carry a strokeWidth with no stroke (e.g. stroke set on hover only);
          // canvas ignores it, so we must too. Otherwise the transparent stroke
          // band insets the fill and the rect renders ~strokeWidth/2 px too small.
          const swidth = stroke ? (strokeWidth ?? 1) : 0;
          return [
              x,
              y,
              width,
              height,
              ...col,
              ...scol,
              swidth,
              cornerRadiusTopRight ?? cornerRadius,
              cornerRadiusBottomRight ?? cornerRadius,
              cornerRadiusBottomLeft ?? cornerRadius,
              cornerRadiusTopLeft ?? cornerRadius,
          ];
      }));
  }
  var rect = {
      type: 'rect',
      draw: draw$8,
  };

  const drawName$7 = 'Group';
  function getResources$7(device, ctx, vb) {
      return getMarkResources(ctx, 'group', device, () => {
          const bufferManager = new BufferManager(device, drawName$7, ctx._uniforms.resolution, [vb.x1, vb.y1]);
          const vertexManager = new VertexBufferManager(['float32x2'], // position
          // center, dimensions, fill color, stroke color, stroke width, corner radii
          ['float32x2', 'float32x2', 'float32x4', 'float32x4', 'float32', 'float32x4']);
          const pipeline = createRenderPipeline(drawName$7, device, ctx._shaderCache[drawName$7], preferredColorFormat(), ctx._sampleCount, vertexManager.getBuffers());
          const gradientPipeline = createRenderPipeline(`${drawName$7}Gradient`, device, ctx._shaderCache[drawName$7], preferredColorFormat(), ctx._sampleCount, vertexManager.getBuffers(), undefined, 'main_fragment_gradient');
          const geometryBuffer = bufferManager.createGeometryBuffer(quadVertex);
          return { device, bufferManager, vertexManager, pipeline, gradientPipeline, geometryBuffer };
      });
  }
  function draw$7(device, ctx, scene, vb, markTypes) {
      const items = scene.items;
      if (!items?.length) {
          return;
      }
      const res = getResources$7(device, ctx, vb);
      res.bufferManager.setResolution(ctx._uniforms.resolution);
      res.bufferManager.setOffset([vb.x1, vb.y1]);
      const uniformBuffer = res.bufferManager.createUniformBuffer();
      const uniformBindGroup = createUniformBindGroup(drawName$7, device, res.pipeline, uniformBuffer);
      // Group backgrounds share the rect instance layout and shader.
      const gres = getGradientResources(device, ctx);
      let run = [];
      const flushRun = () => {
          if (run.length === 0) {
              return;
          }
          const instanceBuffer = res.bufferManager.createInstanceBuffer(rectAttributes(run));
          ctx._renderQueue.enqueue({
              pipeline: res.pipeline,
              drawCounts: [6, run.length],
              vertexBuffers: [res.geometryBuffer, instanceBuffer],
              bindGroups: [uniformBindGroup],
              clip: ctx._clip,
          });
          run = [];
      };
      for (const item of items) {
          if (!isGradient(item.fill)) {
              run.push(item);
              continue;
          }
          flushRun();
          const instanceBuffer = res.bufferManager.createInstanceBuffer(rectAttributes([item], true));
          ctx._renderQueue.enqueue({
              pipeline: res.gradientPipeline,
              drawCounts: [6, 1],
              vertexBuffers: [res.geometryBuffer, instanceBuffer],
              bindGroups: [
                  createUniformBindGroup(`${drawName$7}Gradient`, device, res.gradientPipeline, uniformBuffer),
                  createGradientBindGroup(gres, res.gradientPipeline, item.fill, [0, 0, 1, 1]),
              ],
              clip: ctx._clip,
          });
      }
      flushRun();
      visit(scene, (group) => {
          const gx = group.x || 0;
          const gy = group.y || 0;
          const gw = group.width || 0;
          const gh = group.height || 0;
          // accumulate the group translation for nested marks
          ctx._tx += gx;
          ctx._ty += gy;
          const oldClip = ctx._clip;
          if (group.clip) {
              const dpi = ctx._uniforms.dpi;
              ctx._clip = [(ctx._origin[0] + ctx._tx) * dpi, (ctx._origin[1] + ctx._ty) * dpi, gw * dpi, gh * dpi];
          }
          if (vb) {
              vb.translate(-gx, -gy);
          }
          visit(group, (item) => {
              if (item.marktype === 'group' || markTypes == null || markTypes.includes(item.marktype)) {
                  this.draw(device, ctx, item, vb, markTypes);
              }
          });
          if (vb) {
              vb.translate(gx, gy);
          }
          if (group.clip) {
              ctx._clip = oldClip;
          }
          ctx._tx -= gx;
          ctx._ty -= gy;
      });
  }
  var group = {
      type: 'group',
      draw: draw$7,
  };

  const drawName$6 = 'Image';
  function getResources$6(device, ctx, vb) {
      return getMarkResources(ctx, 'image', device, () => {
          const bufferManager = new BufferManager(device, drawName$6, ctx._uniforms.resolution, [vb.x1, vb.y1]);
          const vertexManager = new VertexBufferManager(['float32x2'], // position
          ['float32x2', 'float32x2', 'float32']);
          const pipeline = createRenderPipeline(drawName$6, device, ctx._shaderCache[drawName$6], preferredColorFormat(), ctx._sampleCount, vertexManager.getBuffers());
          const geometryBuffer = bufferManager.createGeometryBuffer(quadVertex);
          const smoothSampler = device.createSampler({
              label: 'Image Sampler (smooth)',
              magFilter: 'linear',
              minFilter: 'linear',
          });
          const pixelatedSampler = device.createSampler({
              label: 'Image Sampler (pixelated)',
              magFilter: 'nearest',
              minFilter: 'nearest',
          });
          return {
              device,
              bufferManager,
              vertexManager,
              pipeline,
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
      const texture = device.createTexture({
          label: 'Image Texture',
          size: [width, height, 1],
          format: 'rgba8unorm',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
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
      device.queue.copyExternalImageToTexture({ source }, { texture }, [width, height]);
      return texture;
  }
  function getBindGroup(res, image, smooth) {
      let entry = res.textures.get(image);
      if (!entry) {
          entry = { texture: uploadTexture(res.device, image) };
          res.textures.set(image, entry);
      }
      const key = smooth ? 'smoothBindGroup' : 'pixelatedBindGroup';
      let bindGroup = entry[key];
      if (!bindGroup) {
          bindGroup = res.device.createBindGroup({
              label: `Image Texture Bind Group (${smooth ? 'smooth' : 'pixelated'})`,
              layout: res.pipeline.getBindGroupLayout(1),
              entries: [
                  { binding: 0, resource: smooth ? res.smoothSampler : res.pixelatedSampler },
                  { binding: 1, resource: entry.texture.createView() },
              ],
          });
          entry[key] = bindGroup;
      }
      return bindGroup;
  }
  function draw$6(device, ctx, scene, vb) {
      const items = scene.items;
      if (!items?.length) {
          return;
      }
      const res = getResources$6(device, ctx, vb);
      res.bufferManager.setResolution(ctx._uniforms.resolution);
      res.bufferManager.setOffset([vb.x1, vb.y1]);
      const uniformBuffer = res.bufferManager.createUniformBuffer();
      const uniformBindGroup = createUniformBindGroup(drawName$6, device, res.pipeline, uniformBuffer);
      const clip = markClip(ctx, scene);
      for (const item of items) {
          const image = getImage(item, this);
          let w = imageWidth(item, image);
          let h = imageHeight(item, image);
          if (w === 0 || h === 0 || !(image.complete || image.toDataURL)) {
              continue; // not loaded yet; the renderer re-renders on arrival
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
          ctx._renderQueue.enqueue({
              pipeline: res.pipeline,
              drawCounts: [6, 1],
              vertexBuffers: [res.geometryBuffer, instanceBuffer],
              bindGroups: [uniformBindGroup, getBindGroup(res, image, item.smooth !== false)],
              clip,
          });
      }
  }
  var image = {
      type: 'image',
      draw: draw$6,
  };

  const drawName$5 = 'Line';
  // Round joins are drawn as filled circles at interior vertices.
  const JOIN_SEGMENTS = 24;
  function getResources$5(device, ctx, vb) {
      return getMarkResources(ctx, 'line', device, () => {
          const bufferManager = new BufferManager(device, drawName$5, ctx._uniforms.resolution, [vb.x1, vb.y1]);
          const batchVertexManager = new VertexBufferManager([], ['float32x2', 'float32x2', 'float32x4', 'float32', 'float32x2', 'float32x2']);
          const instancedVertexManager = new VertexBufferManager([], ['float32x2', 'float32x2', 'float32x4', 'float32']);
          const batchPipeline = createRenderPipeline(drawName$5, device, ctx._shaderCache['Line'], preferredColorFormat(), ctx._sampleCount, batchVertexManager.getBuffers());
          const instancedPipeline = createRenderPipeline(`S${drawName$5}`, device, ctx._shaderCache['SLine'], preferredColorFormat(), ctx._sampleCount, instancedVertexManager.getBuffers());
          const joinVertexManager = new VertexBufferManager(['float32x2'], // position (unit circle)
          // center, radius, fill color, stroke color, stroke width (symbol layout)
          ['float32x2', 'float32', 'float32x4', 'float32x4', 'float32']);
          const joinPipeline = createRenderPipeline(`${drawName$5}Join`, device, ctx._shaderCache['Symbol'], preferredColorFormat(), ctx._sampleCount, joinVertexManager.getBuffers());
          const joinGeometryBuffer = bufferManager.createGeometryBuffer(createJoinGeometry());
          const curveVertexManager = new VertexBufferManager(['float32x3', 'float32x4']); // position, color
          const curvePipeline = createRenderPipeline(`${drawName$5}Curve`, device, ctx._shaderCache['Path'], preferredColorFormat(), ctx._sampleCount, curveVertexManager.getBuffers());
          return {
              curveVertexManager,
              curvePipeline,
              device,
              bufferManager,
              batchVertexManager,
              instancedVertexManager,
              batchPipeline,
              instancedPipeline,
              joinPipeline,
              joinVertexManager,
              joinGeometryBuffer,
          };
      });
  }
  /**
   * True when the mark cannot be drawn as a plain polyline, either because it
   * uses a curve interpolation or because `defined: false` puts gaps in it.
   */
  function needsPath(points) {
      const interp = points[0]?.interpolate;
      if (interp && interp !== 'linear') {
          return true;
      }
      return points.some(p => p.defined === false);
  }
  /** Curved or gapped lines go through the shared path tessellation. */
  function drawPath(device, ctx, res, points, clip) {
      const first = points[0];
      const shapeGeom = line$1(ctx, points);
      const geometry = geometryForItem(ctx, { ...first, fill: undefined }, shapeGeom);
      const stroke = Color.from2(first.stroke, first.opacity, first.strokeOpacity);
      const [, strokeData] = geometryVertexData(geometry, [0, 0, 0, 0], stroke);
      if (strokeData.length === 0) {
          return;
      }
      ctx._renderQueue.enqueue({
          pipeline: res.curvePipeline,
          drawCounts: [strokeData.length / res.curveVertexManager.getVertexLength()],
          vertexBuffers: [res.bufferManager.createGeometryBuffer(strokeData)],
          bindGroups: [
              createUniformBindGroup(`${drawName$5}Curve`, device, res.curvePipeline, res.bufferManager.createUniformBuffer()),
          ],
          clip,
      });
  }
  function draw$5(device, ctx, scene, vb) {
      const items = scene.items;
      if (!items?.length) {
          return;
      }
      const res = getResources$5(device, ctx, vb);
      res.bufferManager.setResolution(ctx._uniforms.resolution);
      res.bufferManager.setOffset([vb.x1, vb.y1]);
      const points = items;
      const clip = markClip(ctx, scene);
      if (needsPath(points)) {
          drawPath(device, ctx, res, points, clip);
          return;
      }
      if (ctx._renderer.wgOptions.renderBatch === true) {
          // One instanced draw per line mark.
          const uniformBindGroup = createUniformBindGroup(`S${drawName$5}`, device, res.instancedPipeline, res.bufferManager.createUniformBuffer());
          if (items.length < 2) {
              return; // a single point has no segment to draw
          }
          const instanceBuffer = res.bufferManager.createInstanceBuffer(createAttributes$1(points));
          ctx._renderQueue.enqueue({
              pipeline: res.instancedPipeline,
              drawCounts: [6, items.length - 1],
              vertexBuffers: [instanceBuffer],
              bindGroups: [uniformBindGroup],
              clip,
          });
      }
      else {
          // Accumulate segments of consecutive line marks into one draw call
          // (e.g. parallel coordinates). Resolution and offset travel per instance.
          ctx._renderQueue.setupBatch({
              device,
              vertexManager: res.batchVertexManager,
              pipeline: res.batchPipeline,
              clip,
              bindGroups: [],
          });
          const resolution = res.bufferManager.getResolution();
          const offset = res.bufferManager.getOffset();
          for (let i = 0; i < points.length - 1; i++) {
              const { x = 0, y = 0, stroke, strokeOpacity = 1, strokeWidth = 1, opacity = 1 } = points[i];
              const x2 = points[i + 1].x ?? 0;
              const y2 = points[i + 1].y ?? 0;
              const col = Color.from2(stroke, opacity, strokeOpacity);
              ctx._renderQueue.queueBatchInstance([
                  x,
                  y,
                  x2,
                  y2,
                  col[0],
                  col[1],
                  col[2],
                  col[3],
                  strokeWidth,
                  resolution[0],
                  resolution[1],
                  offset[0],
                  offset[1],
              ]);
          }
      }
      // Round joins: fill the gap at each interior vertex where two segment quads
      // meet at an angle (otherwise the outer corner of every bend is notched).
      if (points.length > 2) {
          const joinData = createJoinAttributes(points);
          if (joinData.length > 0) {
              const joinUniformBindGroup = createUniformBindGroup(`${drawName$5}Join`, device, res.joinPipeline, res.bufferManager.createUniformBuffer());
              ctx._renderQueue.enqueue({
                  pipeline: res.joinPipeline,
                  drawCounts: [JOIN_SEGMENTS * 3, points.length - 2],
                  vertexBuffers: [res.joinGeometryBuffer, res.bufferManager.createInstanceBuffer(joinData)],
                  bindGroups: [joinUniformBindGroup],
                  clip,
              });
          }
      }
  }
  /** Symbol-shader instance data for a filled circle at each interior vertex. */
  function createJoinAttributes(points) {
      const count = points.length - 2;
      const result = new Float32Array(count * 12);
      let index = 0;
      for (let i = 1; i < points.length - 1; i++) {
          const { x = 0, y = 0, stroke, strokeOpacity = 1, strokeWidth = 1, opacity = 1 } = points[i];
          const col = Color.from2(stroke, opacity, strokeOpacity);
          result[index] = x;
          result[index + 1] = y;
          result[index + 2] = strokeWidth / 2; // radius
          result[index + 3] = col[0];
          result[index + 4] = col[1];
          result[index + 5] = col[2];
          result[index + 6] = col[3];
          // transparent stroke, zero stroke width -> a plain filled circle
          result[index + 11] = 0;
          index += 12;
      }
      return result;
  }
  /** Unit-circle triangle fan matching the symbol geometry (scaled in-shader). */
  function createJoinGeometry() {
      return new Float32Array(Array.from({ length: JOIN_SEGMENTS }, (_, i) => {
          const j = (i + 1) % JOIN_SEGMENTS;
          const ang1 = ((Math.PI * 2.0) / JOIN_SEGMENTS) * i;
          const ang2 = ((Math.PI * 2.0) / JOIN_SEGMENTS) * j;
          return [Math.cos(ang1), Math.sin(ang1), 0, 0, Math.cos(ang2), Math.sin(ang2)];
      }).flat());
  }
  function createAttributes$1(points) {
      const result = new Float32Array((points.length - 1) * 9);
      for (let i = 0; i < points.length - 1; i++) {
          const { x = 0, y = 0, stroke, strokeOpacity = 1, strokeWidth = 1, opacity = 1 } = points[i];
          const x2 = points[i + 1].x ?? 0;
          const y2 = points[i + 1].y ?? 0;
          const col = Color.from2(stroke, opacity, strokeOpacity);
          const index = i * 9;
          result[index] = x;
          result[index + 1] = y;
          result[index + 2] = x2;
          result[index + 3] = y2;
          result[index + 4] = col[0];
          result[index + 5] = col[1];
          result[index + 6] = col[2];
          result[index + 7] = col[3];
          result[index + 8] = strokeWidth;
      }
      return result;
  }
  var line = {
      type: 'line',
      draw: draw$5,
  };

  const drawName$4 = 'Path';
  function getResources$4(device, ctx, vb) {
      return getMarkResources(ctx, 'path', device, () => {
          const bufferManager = new BufferManager(device, drawName$4, ctx._uniforms.resolution, [vb.x1, vb.y1]);
          const vertexManager = new VertexBufferManager(['float32x3', 'float32x4']);
          const pipeline = createRenderPipeline(drawName$4, device, ctx._shaderCache[drawName$4], preferredColorFormat(), ctx._sampleCount, vertexManager.getBuffers());
          const gradientPipeline = createRenderPipeline(`${drawName$4}Gradient`, device, ctx._shaderCache['GradientFill'], preferredColorFormat(), ctx._sampleCount, vertexManager.getBuffers());
          return { device, bufferManager, vertexManager, pipeline, gradientPipeline };
      });
  }
  function draw$4(device, ctx, scene, vb) {
      const items = scene.items;
      if (!items?.length) {
          return;
      }
      const res = getResources$4(device, ctx, vb);
      res.bufferManager.setResolution(ctx._uniforms.resolution);
      res.bufferManager.setOffset([vb.x1, vb.y1]);
      const uniformBuffer = res.bufferManager.createUniformBuffer();
      const clip = markClip(ctx, scene);
      const vertexLength = res.vertexManager.getVertexLength();
      // Solid fills and strokes share one pipeline and are accumulated in paint
      // order into a single buffer/draw. Gradient fills interrupt the batch.
      const batch = new GeometryBatch();
      const flushBatch = () => {
          const data = batch.flush();
          if (data) {
              ctx._renderQueue.enqueue({
                  pipeline: res.pipeline,
                  drawCounts: [data.length / vertexLength],
                  vertexBuffers: [res.bufferManager.createGeometryBuffer(data)],
                  bindGroups: [createUniformBindGroup(drawName$4, device, res.pipeline, uniformBuffer)],
                  clip,
              });
          }
      };
      for (const item of items) {
          const bounds = item.bounds;
          const gradient = isGradient(item.fill) && bounds ? item.fill : null;
          const gBounds = gradient && bounds ? gradientBounds(ctx, bounds) : null;
          const shapeGeom = geometryForPath(ctx, item.path);
          // path items carry their own x/y translation (matching the canvas mark)
          const geometry = geometryForItem(ctx, item, shapeGeom, false, item.x || 0, item.y || 0);
          const fill = gradient
              ? whiteCarrier(item.opacity, item.fillOpacity)
              : Color.from2(item.fill, item.opacity, item.fillOpacity);
          const stroke = Color.from2(item.stroke, item.opacity, item.strokeOpacity);
          const [fillData, strokeData] = geometryVertexData(geometry, fill, stroke);
          if (fillData.length > 0 && gradient && gBounds) {
              flushBatch();
              const gres = getGradientResources(device, ctx);
              ctx._renderQueue.enqueue({
                  pipeline: res.gradientPipeline,
                  drawCounts: [fillData.length / vertexLength],
                  vertexBuffers: [res.bufferManager.createGeometryBuffer(fillData)],
                  bindGroups: [
                      createUniformBindGroup(`${drawName$4}Gradient`, device, res.gradientPipeline, uniformBuffer),
                      createGradientBindGroup(gres, res.gradientPipeline, gradient, gBounds),
                  ],
                  clip,
              });
          }
          else {
              batch.push(fillData);
          }
          batch.push(strokeData);
      }
      flushBatch();
  }
  var path = {
      type: 'path',
      draw: draw$4,
  };

  const drawName$3 = 'Rule';
  function getResources$3(device, ctx, vb) {
      return getMarkResources(ctx, 'rule', device, () => {
          const bufferManager = new BufferManager(device, drawName$3, ctx._uniforms.resolution, [vb.x1, vb.y1]);
          const vertexManager = new VertexBufferManager(['float32x2'], // position
          // center, scale, color, half-thickness offset
          ['float32x2', 'float32x2', 'float32x4', 'float32x2']);
          const pipeline = createRenderPipeline(drawName$3, device, ctx._shaderCache[drawName$3], preferredColorFormat(), ctx._sampleCount, vertexManager.getBuffers());
          // A rule with both x2 and y2 set is a diagonal segment, which an
          // axis-aligned quad cannot express. Those go through the single-segment
          // line shader instead.
          const diagonalVertexManager = new VertexBufferManager([], ['float32x2', 'float32x2', 'float32x4', 'float32']);
          const diagonalPipeline = createRenderPipeline(`${drawName$3}Diagonal`, device, ctx._shaderCache['SLine'], preferredColorFormat(), ctx._sampleCount, diagonalVertexManager.getBuffers());
          const geometryBuffer = bufferManager.createGeometryBuffer(quadVertex);
          return { device, bufferManager, vertexManager, pipeline, diagonalPipeline, geometryBuffer };
      });
  }
  /** True when the rule runs at an angle, so it cannot be drawn as a rect. */
  function isDiagonal(item) {
      const x = item.x || 0;
      const y = item.y || 0;
      return (item.x2 ?? x) !== x && (item.y2 ?? y) !== y;
  }
  function draw$3(device, ctx, scene, vb) {
      const items = scene.items;
      if (!items?.length) {
          return;
      }
      const res = getResources$3(device, ctx, vb);
      res.bufferManager.setResolution(ctx._uniforms.resolution);
      res.bufferManager.setOffset([vb.x1, vb.y1]);
      const uniformBuffer = res.bufferManager.createUniformBuffer();
      const uniformBindGroup = createUniformBindGroup(drawName$3, device, res.pipeline, uniformBuffer);
      const clip = markClip(ctx, scene);
      let run = [];
      const flushRun = () => {
          if (run.length === 0) {
              return;
          }
          const instanceBuffer = res.bufferManager.createInstanceBuffer(createAttributes(run));
          ctx._renderQueue.enqueue({
              pipeline: res.pipeline,
              drawCounts: [6, run.length],
              vertexBuffers: [res.geometryBuffer, instanceBuffer],
              bindGroups: [uniformBindGroup],
              clip,
          });
          run = [];
      };
      for (const item of items) {
          if (!isDiagonal(item)) {
              run.push(item);
              continue;
          }
          flushRun();
          const instanceBuffer = res.bufferManager.createInstanceBuffer(createDiagonalAttributes(item));
          ctx._renderQueue.enqueue({
              pipeline: res.diagonalPipeline,
              drawCounts: [6, 1],
              vertexBuffers: [instanceBuffer],
              bindGroups: [createUniformBindGroup(`${drawName$3}Diagonal`, device, res.diagonalPipeline, uniformBuffer)],
              clip,
          });
      }
      flushRun();
  }
  function createAttributes(items) {
      return Float32Array.from(items.flatMap(item => {
          const { x = 0, y = 0, x2, y2, stroke, strokeWidth = 1, opacity = 1, strokeOpacity = 1 } = item;
          const ex = x2 ?? x;
          const ey = y2 ?? y;
          const ax = Math.abs(ex - x);
          const ay = Math.abs(ey - y);
          const col = Color.from(stroke, opacity, strokeOpacity);
          const w = ax ? ax : strokeWidth;
          const h = ay ? ay : strokeWidth;
          const offX = ax ? 0 : strokeWidth / 2;
          const offY = ay ? 0 : strokeWidth / 2;
          return [Math.min(x, ex), Math.min(y, ey), w, h, ...col.rgba, offX, offY];
      }));
  }
  /** Single-segment instance for the SLine shader: start, end, color, width. */
  function createDiagonalAttributes(item) {
      const { x = 0, y = 0, x2, y2, stroke, strokeWidth = 1, opacity = 1, strokeOpacity = 1 } = item;
      const col = Color.from2(stroke, opacity, strokeOpacity);
      return Float32Array.from([x, y, x2 ?? x, y2 ?? y, ...col, strokeWidth]);
  }
  var rule = {
      type: 'rule',
      draw: draw$3,
  };

  const drawName$2 = 'Shape';
  function getResources$2(device, ctx, vb) {
      return getMarkResources(ctx, 'shape', device, () => {
          const bufferManager = new BufferManager(device, drawName$2, ctx._uniforms.resolution, [vb.x1, vb.y1]);
          const vertexManager = new VertexBufferManager(['float32x3', 'float32x4'], // position, color
          []);
          const pipeline = createRenderPipeline(drawName$2, device, ctx._shaderCache[drawName$2], preferredColorFormat(), ctx._sampleCount, vertexManager.getBuffers());
          const gradientPipeline = createRenderPipeline(`${drawName$2}Gradient`, device, ctx._shaderCache['GradientFill'], preferredColorFormat(), ctx._sampleCount, vertexManager.getBuffers());
          return { device, bufferManager, vertexManager, pipeline, gradientPipeline, cache: new Map() };
      });
  }
  function draw$2(device, ctx, scene, vb) {
      const items = scene.items;
      if (!items?.length) {
          return;
      }
      const res = getResources$2(device, ctx, vb);
      res.bufferManager.setResolution(ctx._uniforms.resolution);
      res.bufferManager.setOffset([vb.x1, vb.y1]);
      const uniformBuffer = res.bufferManager.createUniformBuffer();
      const useCache = ctx._renderer.wgOptions.cacheShapes ?? false;
      const clip = markClip(ctx, scene);
      const vertexLength = res.vertexManager.getVertexLength();
      // Solid fills and strokes share one pipeline and are accumulated in paint
      // order into a single buffer/draw. Gradient fills interrupt the batch.
      const batch = new GeometryBatch();
      const flushBatch = () => {
          const data = batch.flush();
          if (data) {
              ctx._renderQueue.enqueue({
                  pipeline: res.pipeline,
                  drawCounts: [data.length / vertexLength],
                  vertexBuffers: [res.bufferManager.createGeometryBuffer(data)],
                  bindGroups: [createUniformBindGroup(drawName$2, device, res.pipeline, uniformBuffer)],
                  clip,
              });
          }
      };
      for (const item of items) {
          const bounds = item.bounds;
          const gradient = isGradient(item.fill) && bounds ? item.fill : null;
          const [fillData, strokeData] = createGeometryData(ctx, res, item, gradient !== null, useCache);
          if (fillData.length > 0 && gradient && bounds) {
              flushBatch();
              const gres = getGradientResources(device, ctx);
              ctx._renderQueue.enqueue({
                  pipeline: res.gradientPipeline,
                  drawCounts: [fillData.length / vertexLength],
                  vertexBuffers: [res.bufferManager.createGeometryBuffer(fillData)],
                  bindGroups: [
                      createUniformBindGroup(`${drawName$2}Gradient`, device, res.gradientPipeline, uniformBuffer),
                      createGradientBindGroup(gres, res.gradientPipeline, gradient, gradientBounds(ctx, bounds)),
                  ],
                  clip,
              });
          }
          else {
              batch.push(fillData);
          }
          batch.push(strokeData);
      }
      flushBatch();
  }
  function cacheKey(item) {
      if (item.datum?.id != null) {
          return item.datum.id;
      }
      if (item.id != null) {
          return item.id;
      }
      // vega tuple ids are stored under a symbol property
      const symbols = Object.getOwnPropertySymbols(item);
      return symbols.length > 0 ? item[symbols[0]] : item;
  }
  function sameColor(a, b) {
      return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
  }
  function recolor(data, source, color) {
      for (let i = 0; i < data.length; i += 7) {
          data[i] = source[i];
          data[i + 1] = source[i + 1];
          data[i + 2] = source[i + 2];
          data[i + 3] = color[0];
          data[i + 4] = color[1];
          data[i + 5] = color[2];
          data[i + 6] = color[3];
      }
  }
  function createGeometryData(ctx, res, item, hasGradient, useCache) {
      const key = cacheKey(item);
      const fill = hasGradient
          ? whiteCarrier(item.opacity, item.fillOpacity)
          : Color.from2(item.fill, item.opacity, item.fillOpacity);
      const stroke = Color.from2(item.stroke, item.opacity, item.strokeOpacity);
      if (useCache) {
          const entry = res.cache.get(key);
          if (entry &&
              item.strokeWidth === entry.strokeWidth &&
              item.x === entry.x &&
              item.y === entry.y &&
              sameBounds(item.bounds, entry.bounds)) {
              if (sameColor(entry.fill, fill) && sameColor(entry.stroke, stroke)) {
                  return entry.data;
              }
              // geometry unchanged, rewrite only the colors
              const data = [
                  new Float32Array(entry.data[0].length),
                  new Float32Array(entry.data[1].length),
              ];
              recolor(data[0], entry.data[0], fill);
              recolor(data[1], entry.data[1], stroke);
              return data;
          }
      }
      const shapeGeom = shape$1(ctx, item);
      const geometry = geometryForItem(ctx, item, shapeGeom);
      const data = geometryVertexData(geometry, fill, stroke);
      if (useCache) {
          res.cache.set(key, {
              fill,
              stroke,
              x: item.x,
              y: item.y,
              bounds: copyBounds(item.bounds),
              strokeWidth: item.strokeWidth,
              data,
          });
      }
      return data;
  }
  function copyBounds(b) {
      return b ? { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 } : undefined;
  }
  function sameBounds(b, snap) {
      if (b === undefined || snap === undefined) {
          return b === undefined && snap === undefined;
      }
      return b.x1 === snap.x1 && b.y1 === snap.y1 && b.x2 === snap.x2 && b.y2 === snap.y2;
  }
  var shape = {
      type: 'shape',
      draw: draw$2,
  };

  const segments = 32;
  const drawName$1 = 'Symbol';
  // Bounds the triangulated-shape cache. `size` is continuous, so a size-encoded
  // chart would otherwise mint a GPU buffer per distinct size, forever.
  const MAX_SHAPE_CACHE = 256;
  function getResources$1(device, ctx, vb) {
      return getMarkResources(ctx, 'symbol', device, () => {
          const bufferManager = new BufferManager(device, drawName$1, ctx._uniforms.resolution, [vb.x1, vb.y1]);
          const circleVertexManager = new VertexBufferManager(['float32x2'], // position
          // center, radius, fill color, stroke color, stroke width
          ['float32x2', 'float32', 'float32x4', 'float32x4', 'float32']);
          const circlePipeline = createRenderPipeline(drawName$1, device, ctx._shaderCache[drawName$1], preferredColorFormat(), ctx._sampleCount, circleVertexManager.getBuffers());
          const shapeVertexManager = new VertexBufferManager(['float32x2'], // geometry position (centered on origin)
          ['float32x2', 'float32x4', 'float32']);
          const shapePipeline = createRenderPipeline(`${drawName$1}Shape`, device, ctx._shaderCache['SymbolShape'], preferredColorFormat(), ctx._sampleCount, shapeVertexManager.getBuffers());
          const circleGeometry = bufferManager.createGeometryBuffer(createCircleGeometry());
          const colorVertexManager = new VertexBufferManager(['float32x3', 'float32x4']); // position, color
          const solidPipeline = createRenderPipeline(`${drawName$1}Solid`, device, ctx._shaderCache['Shape'], preferredColorFormat(), ctx._sampleCount, colorVertexManager.getBuffers());
          const gradientPipeline = createRenderPipeline(`${drawName$1}Gradient`, device, ctx._shaderCache['GradientFill'], preferredColorFormat(), ctx._sampleCount, colorVertexManager.getBuffers());
          return {
              device,
              bufferManager,
              circleVertexManager,
              circlePipeline,
              circleGeometry,
              shapePipeline,
              shapeCache: new Map(),
              colorVertexManager,
              solidPipeline,
              gradientPipeline,
          };
      });
  }
  function draw$1(device, ctx, scene, vb) {
      const items = scene.items;
      if (!items?.length) {
          return;
      }
      const res = getResources$1(device, ctx, vb);
      res.bufferManager.setResolution(ctx._uniforms.resolution);
      res.bufferManager.setOffset([vb.x1, vb.y1]);
      const uniformBuffer = res.bufferManager.createUniformBuffer();
      const clip = markClip(ctx, scene);
      let runKind = null;
      let run = [];
      let circleBindGroup = null;
      let shapeBindGroup = null;
      const flushRun = () => {
          if (run.length === 0 || runKind === null) {
              return;
          }
          if (runKind === 'circle') {
              circleBindGroup ??= createUniformBindGroup(drawName$1, device, res.circlePipeline, uniformBuffer);
              const instanceBuffer = res.bufferManager.createInstanceBuffer(createCircleAttributes(run));
              ctx._renderQueue.enqueue({
                  pipeline: res.circlePipeline,
                  drawCounts: [segments * 3, run.length],
                  vertexBuffers: [res.circleGeometry, instanceBuffer],
                  bindGroups: [circleBindGroup],
                  clip,
              });
          }
          else {
              shapeBindGroup ??= createUniformBindGroup(`${drawName$1}Shape`, device, res.shapePipeline, uniformBuffer);
              drawShapeGroup(device, ctx, res, shapeBindGroup, runKind, run, clip);
          }
          run = [];
          runKind = null;
      };
      for (const item of items) {
          // Gradient fills need the gradient pipeline and are drawn one at a time.
          if (isGradient(item.fill)) {
              flushRun();
              drawGradientSymbol(device, ctx, res, item, clip);
              continue;
          }
          const shape = item.shape || 'circle';
          const kind = shape === 'circle' ? 'circle' : `${shape}|${item.size ?? 64}|${item.stroke ? (item.strokeWidth ?? 1) : 0}`;
          if (kind !== runKind) {
              flushRun();
              runKind = kind;
          }
          run.push(item);
      }
      flushRun();
  }
  function drawShapeGroup(device, ctx, res, bindGroup, key, group, clip) {
      const first = group[0];
      const geom = getShapeGeometry(res, ctx, key, first.shape || 'circle', first.size ?? 64, first.strokeWidth ?? 1);
      if (geom.fill && geom.fillCount > 0) {
          const instances = instanceData(group, item => Color.from2(item.fill, item.opacity, item.fillOpacity), item => Boolean(item.fill && item.fill !== 'transparent'));
          if (instances.count > 0) {
              ctx._renderQueue.enqueue({
                  pipeline: res.shapePipeline,
                  drawCounts: [geom.fillCount, instances.count],
                  vertexBuffers: [geom.fill, res.bufferManager.createInstanceBuffer(instances.data)],
                  bindGroups: [bindGroup],
                  clip,
              });
          }
      }
      if (geom.stroke && geom.strokeCount > 0) {
          const instances = instanceData(group, item => Color.from2(item.stroke, item.opacity, item.strokeOpacity), item => Boolean(item.stroke && item.stroke !== 'transparent'));
          if (instances.count > 0) {
              ctx._renderQueue.enqueue({
                  pipeline: res.shapePipeline,
                  drawCounts: [geom.strokeCount, instances.count],
                  vertexBuffers: [geom.stroke, res.bufferManager.createInstanceBuffer(instances.data)],
                  bindGroups: [bindGroup],
                  clip,
              });
          }
      }
  }
  /** Draws one gradient-filled symbol: gradient fill + solid stroke, triangulated. */
  function drawGradientSymbol(device, ctx, res, item, clip) {
      const bounds = item.bounds;
      if (!bounds) {
          return;
      }
      const pathGeom = symbol$1(ctx, item.shape || 'circle', item.size ?? 64);
      const geometry = geometryForItem(ctx, item, pathGeom, false, item.x || 0, item.y || 0);
      const fill = whiteCarrier(item.opacity, item.fillOpacity);
      const stroke = Color.from2(item.stroke, item.opacity, item.strokeOpacity);
      const [fillData, strokeData] = geometryVertexData(geometry, fill, stroke);
      const uniformBuffer = res.bufferManager.createUniformBuffer();
      const vertexLength = res.colorVertexManager.getVertexLength();
      if (fillData.length > 0) {
          const gres = getGradientResources(device, ctx);
          ctx._renderQueue.enqueue({
              pipeline: res.gradientPipeline,
              drawCounts: [fillData.length / vertexLength],
              vertexBuffers: [res.bufferManager.createGeometryBuffer(fillData)],
              bindGroups: [
                  createUniformBindGroup(`${drawName$1}Gradient`, device, res.gradientPipeline, uniformBuffer),
                  createGradientBindGroup(gres, res.gradientPipeline, item.fill, gradientBounds(ctx, bounds)),
              ],
              clip,
          });
      }
      if (strokeData.length > 0) {
          ctx._renderQueue.enqueue({
              pipeline: res.solidPipeline,
              drawCounts: [strokeData.length / vertexLength],
              vertexBuffers: [res.bufferManager.createGeometryBuffer(strokeData)],
              bindGroups: [createUniformBindGroup(`${drawName$1}Solid`, device, res.solidPipeline, uniformBuffer)],
              clip,
          });
      }
  }
  const DEG_TO_RAD = Math.PI / 180;
  /** Builds [centerX, centerY, r, g, b, a, angle] instance rows for items passing `keep`. */
  function instanceData(group, color, keep) {
      const rows = [];
      let count = 0;
      for (const item of group) {
          if (!keep(item)) {
              continue;
          }
          const c = color(item);
          rows.push(item.x ?? 0, item.y ?? 0, c[0], c[1], c[2], c[3], (item.angle ?? 0) * DEG_TO_RAD);
          count++;
      }
      return { data: Float32Array.from(rows), count };
  }
  function getShapeGeometry(res, ctx, key, shape, size, strokeWidth) {
      const cached = res.shapeCache.get(key);
      if (cached) {
          res.shapeCache.delete(key);
          res.shapeCache.set(key, cached);
          return cached;
      }
      const pathGeom = symbol$1(ctx, shape, size);
      // Origin-centered fill + stroke triangles (dx/dy default to 0).
      const geometry = geometryForItem(ctx, { fill: '#000', stroke: '#000', strokeWidth, opacity: 1 }, pathGeom);
      const entry = {
          fill: geometry.fillCount > 0
              ? res.bufferManager.createGeometryBuffer(stripZ(geometry.fillTriangles, geometry.fillCount))
              : null,
          fillCount: geometry.fillCount,
          stroke: geometry.strokeCount > 0
              ? res.bufferManager.createGeometryBuffer(stripZ(geometry.strokeTriangles, geometry.strokeCount))
              : null,
          strokeCount: geometry.strokeCount,
      };
      if (res.shapeCache.size >= MAX_SHAPE_CACHE) {
          const oldest = res.shapeCache.keys().next().value;
          if (oldest !== undefined) {
              const evicted = res.shapeCache.get(oldest);
              res.shapeCache.delete(oldest);
              if (evicted) {
                  if (evicted.fill) {
                      ctx._renderer?.deferDestroy(evicted.fill);
                  }
                  if (evicted.stroke) {
                      ctx._renderer?.deferDestroy(evicted.stroke);
                  }
              }
          }
      }
      res.shapeCache.set(key, entry);
      return entry;
  }
  /** Drops the z coordinate: [x,y,z]* -> [x,y]* for the 2D shape shader. */
  function stripZ(triangles, count) {
      const out = new Float32Array(count * 2);
      for (let i = 0; i < count; i++) {
          out[i * 2] = triangles[i * 3];
          out[i * 2 + 1] = triangles[i * 3 + 1];
      }
      return out;
  }
  function createCircleAttributes(items) {
      const result = new Float32Array(items.length * 12);
      let index = -1;
      for (let i = 0, len = items.length; i < len; i++) {
          const { x = 0, y = 0, size = 64, fill, stroke, strokeWidth = 1, opacity = 1, fillOpacity = 1, strokeOpacity = 1, } = items[i];
          const col = Color.from2(fill, opacity, fillOpacity);
          const scol = Color.from2(stroke, opacity, strokeOpacity);
          const rad = Math.sqrt(size) / 2;
          result[++index] = x;
          result[++index] = y;
          result[++index] = rad;
          result[++index] = col[0];
          result[++index] = col[1];
          result[++index] = col[2];
          result[++index] = col[3];
          result[++index] = scol[0];
          result[++index] = scol[1];
          result[++index] = scol[2];
          result[++index] = scol[3];
          result[++index] = stroke ? strokeWidth : 0;
      }
      return result;
  }
  function createCircleGeometry() {
      return new Float32Array(Array.from({ length: segments }, (_, i) => {
          const j = (i + 1) % segments;
          const ang1 = !i ? 0 : ((Math.PI * 2.0) / segments) * i;
          const ang2 = !j ? 0 : ((Math.PI * 2.0) / segments) * j;
          const x1 = Math.cos(ang1);
          const y1 = Math.sin(ang1);
          const x2 = Math.cos(ang2);
          const y2 = Math.sin(ang2);
          return [x1, y1, 0, 0, x2, y2];
      }).flat());
  }
  var symbol = {
      type: 'symbol',
      draw: draw$1,
  };

  const HALF_PI = Math.PI / 2;
  const textMark = vegaScenegraph.Marks.text;
  /**
   * Sub-pixel phases are quantized to this many steps per device pixel so the
   * glyph cache does not grow unbounded when the same string is drawn at many
   * fractional positions. 8 steps means at most 1/16 px of placement error, which is imperceptible.
   */
  const PHASE_STEPS = 8;
  /** Quantized fractional part of `v`, in [0, 1), on the PHASE_STEPS grid. */
  function quantizePhase(v) {
      const f = v - Math.floor(v);
      return Math.round(f * PHASE_STEPS) / PHASE_STEPS;
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
   * Cache key over everything that affects the rasterized pixels (not opacity,
   * which the shader applies). `angle` is included because rotation is now baked
   * into the texture. `radius`/`theta` are not, because they only move the anchor
   * in scene space and cancel out of the anchor-relative offset.
   */
  function textCacheKey(item) {
      const text = Array.isArray(item.text) ? item.text.join('') : String(item.text ?? '');
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
          item.fill,
          item.fillOpacity,
          item.stroke,
          item.strokeOpacity,
          item.strokeWidth,
          item.lineBreak,
          item.lineHeight,
          item.limit,
          item.ellipsis,
          item.dir,
      ].join('|');
  }
  /**
   * Rasterizes a text item into a GPU texture using vega-scenegraph's own canvas
   * text mark, so the pixels match the canvas renderer exactly. Two things are
   * baked in so the caller can place a plain, whole-device-pixel quad (crisp, no
   * resampling) that still lands exactly where canvas draws:
   *   - rotation, via the rotated bounding box (bound mode 0), and
   *   - the sub-pixel `phaseX`/`phaseY` (fractional device position of the
   *     anchor), so the glyph's antialiased edges align to the same device grid
   *     the canvas renderer uses. Only opacity is deferred (to the shader).
   */
  function rasterizeText(device, ctx, canvas, c2d, item, phaseX, phaseY) {
      const dpi = ctx._uniforms.dpi || 1;
      const clone = { ...item, opacity: 1 };
      const b = textMark.bound(new vegaScenegraph.Bounds(), clone, 0);
      const [ax, ay] = textAnchor(item);
      // Whole-pixel padding from the anchor to the top-left of the texture, with
      // at least 1px clearance so antialiased edges are never clipped. `anchorTex` is where
      // the anchor lands inside the texture. Its fractional part is the phase.
      const padLeft = Math.ceil(Math.max(0, (ax - b.x1) * dpi)) + 1;
      const padTop = Math.ceil(Math.max(0, (ay - b.y1) * dpi)) + 1;
      const anchorTexX = padLeft + phaseX;
      const anchorTexY = padTop + phaseY;
      const physWidth = Math.ceil(anchorTexX + (b.x2 - ax) * dpi) + 1;
      const physHeight = Math.ceil(anchorTexY + (b.y2 - ay) * dpi) + 1;
      if (physWidth <= 0 || physHeight <= 0) {
          return null;
      }
      // Grow-only. Resizing a canvas recreates its backing store, which invalidates
      // the external image reference the GPU copy takes (an OperationError on Linux
      // Dawn). The glyph is drawn at the top-left and only that region is copied.
      if (canvas.width < physWidth || canvas.height < physHeight) {
          canvas.width = Math.max(canvas.width, physWidth);
          canvas.height = Math.max(canvas.height, physHeight);
      }
      c2d.setTransform(1, 0, 0, 1, 0, 0);
      c2d.clearRect(0, 0, canvas.width, canvas.height);
      c2d.setTransform(dpi, 0, 0, dpi, anchorTexX - dpi * ax, anchorTexY - dpi * ay);
      textMark.draw(c2d, { items: [clone] }, null);
      const texture = device.createTexture({
          label: 'Text Texture',
          size: [physWidth, physHeight, 1],
          format: 'rgba8unorm',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      device.queue.copyExternalImageToTexture({ source: canvas }, { texture }, [physWidth, physHeight]);
      return { texture, physWidth, physHeight, anchorTexX, anchorTexY };
  }

  const drawName = 'Text';
  // Bounds the per-context glyph texture cache so long interactive sessions
  // (panning, zooming, streaming labels) do not leak GPU memory.
  const MAX_CACHE = 1024;
  function getResources(device, ctx, vb) {
      return getMarkResources(ctx, 'text', device, () => {
          const bufferManager = new BufferManager(device, drawName, ctx._uniforms.resolution, [vb.x1, vb.y1]);
          const vertexManager = new VertexBufferManager(['float32x2', 'float32x2']); // position, uv
          const pipeline = createRenderPipeline(drawName, device, ctx._shaderCache[drawName], preferredColorFormat(), ctx._sampleCount, vertexManager.getBuffers());
          const sampler = device.createSampler({
              label: 'Text Sampler',
              magFilter: 'linear',
              minFilter: 'linear',
          });
          const scratch = document.createElement('canvas');
          const scratchCtx = scratch.getContext('2d');
          return { device, bufferManager, vertexManager, pipeline, sampler, scratch, scratchCtx, cache: new Map() };
      });
  }
  /**
   * Glyph texture for one label, baked at its quantized sub-pixel phase so it
   * lands where canvas draws it. Keyed by style, dpi and phase.
   */
  function getTexture(device, ctx, res, item, vb) {
      const dpi = ctx._uniforms.dpi || 1;
      const [ax, ay] = textAnchor(item);
      const phaseX = quantizePhase((ax - vb.x1) * dpi);
      const phaseY = quantizePhase((ay - vb.y1) * dpi);
      const key = `${textCacheKey(item)}|${dpi}|${phaseX}|${phaseY}`;
      const cached = res.cache.get(key);
      if (cached) {
          // re-insert to keep the map in least-recently-used order
          res.cache.delete(key);
          res.cache.set(key, cached);
          return cached;
      }
      const raster = rasterizeText(device, ctx, res.scratch, res.scratchCtx, item, phaseX, phaseY);
      if (!raster) {
          return null;
      }
      if (res.cache.size >= MAX_CACHE) {
          const oldest = res.cache.keys().next().value;
          if (oldest !== undefined) {
              const evicted = res.cache.get(oldest);
              res.cache.delete(oldest);
              // a queued draw may still reference it, so destroy after submit
              if (evicted) {
                  ctx._renderer?.deferDestroy(evicted.texture);
              }
          }
      }
      res.cache.set(key, raster);
      return raster;
  }
  /**
   * Rotation and sub-pixel phase are baked into the texture, so every label is a
   * plain axis-aligned quad on a whole device pixel and maps 1:1 without
   * resampling. The shader maps (position - vb) * dpi to device pixels.
   */
  function draw(device, ctx, scene, vb) {
      const items = scene.items;
      if (!items?.length) {
          return;
      }
      const res = getResources(device, ctx, vb);
      res.bufferManager.setResolution(ctx._uniforms.resolution);
      res.bufferManager.setOffset([vb.x1, vb.y1]);
      const clip = markClip(ctx, scene);
      const [resX, resY] = ctx._uniforms.resolution;
      for (const item of items) {
          const opacity = item.opacity == null ? 1 : item.opacity;
          if (opacity === 0 || (item.fontSize ?? 11) <= 0 || item.text == null || String(item.text).length === 0) {
              continue;
          }
          const tex = getTexture(device, ctx, res, item, vb);
          if (!tex) {
              continue;
          }
          const [ax, ay] = textAnchor(item);
          const dpi = ctx._uniforms.dpi || 1;
          const originPhysX = Math.round((ax - vb.x1) * dpi - tex.anchorTexX);
          const originPhysY = Math.round((ay - vb.y1) * dpi - tex.anchorTexY);
          const x0 = vb.x1 + originPhysX / dpi;
          const y0 = vb.y1 + originPhysY / dpi;
          const x1 = vb.x1 + (originPhysX + tex.physWidth) / dpi;
          const y1 = vb.y1 + (originPhysY + tex.physHeight) / dpi;
          // prettier-ignore
          const verts = Float32Array.from([
              x0, y0, 0, 0, x1, y0, 1, 0, x0, y1, 0, 1,
              x1, y0, 1, 0, x1, y1, 1, 1, x0, y1, 0, 1,
          ]);
          const vertexBuffer = res.bufferManager.createGeometryBuffer(verts);
          // prettier-ignore
          const uniformData = Float32Array.from([resX, resY, vb.x1, vb.y1, opacity, 0, 0, 0]);
          const uniformBuffer = res.bufferManager.createBuffer(`${drawName} Uniform`, uniformData, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
          const uniformBindGroup = createUniformBindGroup(drawName, device, res.pipeline, uniformBuffer);
          const textureBindGroup = device.createBindGroup({
              label: 'Text Texture Bind Group',
              layout: res.pipeline.getBindGroupLayout(1),
              entries: [
                  { binding: 0, resource: res.sampler },
                  { binding: 1, resource: tex.texture.createView() },
              ],
          });
          ctx._renderQueue.enqueue({
              pipeline: res.pipeline,
              drawCounts: [6, 1],
              vertexBuffers: [vertexBuffer],
              bindGroups: [uniformBindGroup, textureBindGroup],
              clip,
          });
      }
  }
  var text = {
      type: 'text',
      draw,
  };

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
  };

  /**
   * Collects draw calls for one frame and submits them in a single command
   * buffer. Each WebGPURenderer instance owns its own queue, so multiple
   * views on a page do not interfere with each other.
   */
  class RenderQueue {
      queue = [];
      batch = [];
      batchInfo = null;
      startFrame() {
          this.queue = [];
          this.batch = [];
          this.batchInfo = null;
      }
      enqueue(element) {
          if (this.batchInfo !== null && element.pipeline !== this.batchInfo.pipeline) {
              this.flushBatch();
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
          this.batch = [];
          this.batchInfo = info;
      }
      queueBatchInstance(values) {
          this.batch.push(...values);
      }
      flushBatch() {
          const info = this.batchInfo;
          if (info === null || this.batch.length === 0) {
              this.batchInfo = null;
              return;
          }
          this.batchInfo = null;
          const data = new BufferManager(info.device, 'RenderBatch').createInstanceBuffer(Float32Array.from(this.batch));
          const instanceCount = this.batch.length / info.vertexManager.getInstanceLength();
          this.batch = [];
          if (info.geometryBuffer == null) {
              this.enqueue({
                  pipeline: info.pipeline,
                  drawCounts: [6, instanceCount],
                  vertexBuffers: [data],
                  bindGroups: info.bindGroups,
                  clip: info.clip,
              });
          }
          else {
              this.enqueue({
                  pipeline: info.pipeline,
                  drawCounts: [info.geometryCount ?? 1, instanceCount],
                  vertexBuffers: [info.geometryBuffer, data],
                  bindGroups: info.bindGroups,
                  clip: info.clip,
              });
          }
      }
      /**
       * Encodes all queued draws into render passes and submits them.
       * Scissor rects are clamped to the attachment size. WebGPU validation
       * rejects scissor rects that extend beyond the render target.
       */
      submit(device, renderPassDescriptor, attachmentSize) {
          this.flushBatch();
          const commandEncoder = device.createCommandEncoder({ label: 'RenderQueue Encoder' });
          // All draws share one render pass: the attachment is loaded/cleared and
          // resolved exactly once per frame. Draw order = scenegraph paint order.
          const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
          let scissored = false;
          for (const q of this.queue) {
              let clip;
              if (q.clip) {
                  const clamped = clampClip(q.clip, attachmentSize);
                  if (clamped === null) {
                      continue; // clipped to nothing
                  }
                  clip = clamped;
              }
              if (clip) {
                  passEncoder.setScissorRect(clip[0], clip[1], clip[2], clip[3]);
                  scissored = true;
              }
              else if (scissored) {
                  // scissor state persists within the pass, so restore full coverage
                  passEncoder.setScissorRect(0, 0, attachmentSize[0], attachmentSize[1]);
                  scissored = false;
              }
              passEncoder.setPipeline(q.pipeline);
              for (let i = 0; i < q.vertexBuffers.length; i++) {
                  passEncoder.setVertexBuffer(i, q.vertexBuffers[i]);
              }
              for (let i = 0; i < q.bindGroups.length; i++) {
                  passEncoder.setBindGroup(i, q.bindGroups[i]);
              }
              passEncoder.draw(q.drawCounts[0], q.drawCounts[1] ?? 1, q.drawCounts[2] ?? 0, q.drawCounts[3] ?? 0);
          }
          passEncoder.end();
          device.queue.submit([commandEncoder.finish()]);
          this.queue = [];
      }
  }
  /**
   * Instances may only share a draw when the pipeline, the scissor rect and the
   * bind groups all match. Matching on the pipeline alone merged marks from
   * differently clipped groups into one draw carrying the first mark's clip.
   */
  function sameBatchTarget(a, b) {
      if (a.pipeline !== b.pipeline || a.geometryBuffer !== b.geometryBuffer || a.geometryCount !== b.geometryCount) {
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
   * Sizes the WebGPU canvas to the view and mirrors the coordinate transform
   * onto the detached pick canvas so geometric hit-testing (isPointInPath)
   * matches what is rendered.
   */
  function resize(canvas, context, width, height, origin, pickCanvas, pickContext, scaleFactor) {
      const inDOM = typeof HTMLElement !== 'undefined' && canvas instanceof HTMLElement && canvas.parentNode != null;
      const ratio = scaleFactor ?? (inDOM ? window.devicePixelRatio || 1 : 1);
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
      context._clip = undefined;
      return canvas;
  }

  var areaShader = "struct Uniforms {\r\n  resolution: vec2<f32>,\r\n  offset: vec2<f32>,\r\n}\r\n\r\n@group(0) @binding(0) var<uniform> uniforms : Uniforms;\r\n\r\nstruct VertexInput {\r\n  @location(0) position: vec3<f32>,\r\n  @location(1) fill_color: vec4<f32>,\r\n}\r\n\r\nstruct VertexOutput {\r\n  @builtin(position) pos: vec4<f32>,\r\n  @location(0) uv: vec2<f32>,\r\n  @location(1) fill: vec4<f32>,\r\n}\r\n\r\n@vertex\r\nfn main_vertex(\r\n    model: VertexInput\r\n) -> VertexOutput {\r\n    var output: VertexOutput;\r\n    var pos = model.position.xy - uniforms.offset;\r\n    pos = pos / uniforms.resolution;\r\n    pos.y = 1.0 - pos.y;\r\n    pos = pos * 2.0 - 1.0;\r\n    output.pos = vec4<f32>(pos, model.position.z + 0.5, 1.0);\r\n    output.uv = pos;\r\n    output.fill = model.fill_color;\r\n    return output;\r\n}\r\n\r\n@fragment\r\nfn main_fragment(in: VertexOutput) -> @location(0) vec4<f32> {\r\n    return in.fill;\r\n}\r\n";

  var gradientFillShader = "struct Uniforms {\r\n  resolution: vec2<f32>,\r\n  offset: vec2<f32>,\r\n}\r\n\r\n// coords = (x1, y1, x2, y2) in normalized item space,\r\n// bounds = (x, y, w, h) of the item in canvas coordinates,\r\n// misc = (kind, r1, r2, unused). kind: 1 = linear, 2 = radial.\r\nstruct GradientParams {\r\n  coords: vec4<f32>,\r\n  bounds: vec4<f32>,\r\n  misc: vec4<f32>,\r\n}\r\n\r\n@group(0) @binding(0) var<uniform> uniforms: Uniforms;\r\n@group(1) @binding(0) var stopSampler: sampler;\r\n@group(1) @binding(1) var stopRamp: texture_2d<f32>;\r\n@group(1) @binding(2) var<uniform> gradient: GradientParams;\r\n\r\nstruct VertexInput {\r\n  @location(0) position: vec3<f32>,\r\n  // vertex color carries only the computed fill opacity in .a\r\n  @location(1) fill_color: vec4<f32>,\r\n}\r\n\r\nstruct VertexOutput {\r\n  @builtin(position) pos: vec4<f32>,\r\n  @location(0) world: vec2<f32>,\r\n  @location(1) fill: vec4<f32>,\r\n}\r\n\r\n@vertex\r\nfn main_vertex(model: VertexInput) -> VertexOutput {\r\n    var output: VertexOutput;\r\n    var pos = model.position.xy - uniforms.offset;\r\n    pos = pos / uniforms.resolution;\r\n    pos.y = 1.0 - pos.y;\r\n    pos = pos * 2.0 - 1.0;\r\n    output.pos = vec4<f32>(pos, model.position.z + 0.5, 1.0);\r\n    output.world = model.position.xy;\r\n    output.fill = model.fill_color;\r\n    return output;\r\n}\r\n\r\n// p is normalized to the item bounds, wh is the bounds size in pixels.\r\n// Linear gradients evaluate in normalized space (matching vega's canvas\r\n// renderer). Radial gradients are circular in pixel space with radii\r\n// scaled by max(w, h).\r\nfn gradientT(p: vec2<f32>, wh: vec2<f32>) -> f32 {\r\n    if gradient.misc.x < 1.5 {\r\n        let a = gradient.coords.xy;\r\n        let b = gradient.coords.zw;\r\n        let ab = b - a;\r\n        let len2 = max(dot(ab, ab), 1e-6);\r\n        return clamp(dot(p - a, ab) / len2, 0.0, 1.0);\r\n    }\r\n    // radial: concentric-circle approximation around (x2, y2)\r\n    let m = max(wh.x, wh.y);\r\n    let c = gradient.coords.zw * wh;\r\n    let r1 = gradient.misc.y * m;\r\n    let r2 = gradient.misc.z * m;\r\n    return clamp((distance(p * wh, c) - r1) / max(r2 - r1, 1e-6), 0.0, 1.0);\r\n}\r\n\r\n@fragment\r\nfn main_fragment(in: VertexOutput) -> @location(0) vec4<f32> {\r\n    let normalized = (in.world - gradient.bounds.xy) / max(gradient.bounds.zw, vec2<f32>(1e-6, 1e-6));\r\n    let t = gradientT(normalized, gradient.bounds.zw);\r\n    let sample = textureSample(stopRamp, stopSampler, vec2<f32>(t, 0.5));\r\n    return vec4<f32>(sample.rgb, sample.a * in.fill.a);\r\n}\r\n";

  var imageShader = "struct Uniforms {\r\n  resolution: vec2<f32>,\r\n  offset: vec2<f32>,\r\n}\r\n\r\n@group(0) @binding(0) var<uniform> uniforms: Uniforms;\r\n@group(1) @binding(0) var imageSampler: sampler;\r\n@group(1) @binding(1) var imageTexture: texture_2d<f32>;\r\n\r\nstruct VertexInput {\r\n  @location(0) position: vec2<f32>, // unit quad, 0..1\r\n}\r\n\r\nstruct InstanceInput {\r\n  @location(1) origin: vec2<f32>,\r\n  @location(2) size: vec2<f32>,\r\n  @location(3) opacity: f32,\r\n}\r\n\r\nstruct VertexOutput {\r\n  @builtin(position) pos: vec4<f32>,\r\n  @location(0) uv: vec2<f32>,\r\n  @location(1) opacity: f32,\r\n}\r\n\r\n@vertex\r\nfn main_vertex(model: VertexInput, instance: InstanceInput) -> VertexOutput {\r\n    var output: VertexOutput;\r\n    var pos = model.position * instance.size + instance.origin - uniforms.offset;\r\n    pos = pos / uniforms.resolution;\r\n    pos.y = 1.0 - pos.y;\r\n    pos = pos * 2.0 - 1.0;\r\n    output.pos = vec4<f32>(pos, 0.0, 1.0);\r\n    output.uv = model.position;\r\n    output.opacity = instance.opacity;\r\n    return output;\r\n}\r\n\r\n@fragment\r\nfn main_fragment(in: VertexOutput) -> @location(0) vec4<f32> {\r\n    let color = textureSample(imageTexture, imageSampler, in.uv);\r\n    return vec4<f32>(color.rgb, color.a * in.opacity);\r\n}\r\n";

  var lineShader = "\r\nstruct VertexInput {\r\n    @location(0) start: vec2<f32>,\r\n    @location(1) end: vec2<f32>,\r\n    @location(2) color: vec4<f32>,\r\n    @location(3) stroke_width: f32,\r\n    @location(4) resolution: vec2<f32>,\r\n    @location(5) offset: vec2<f32>,\r\n};\r\n\r\n\r\nstruct VertexOutput {\r\n    @builtin(position) pos: vec4<f32>,\r\n    @location(0)  uv: vec2<f32>,\r\n    @location(1) fill: vec4<f32>,\r\n    @location(2) smooth_width: f32,\r\n};\r\n\r\nconst smooth_step = 1.5;\r\n\r\n@vertex\r\nfn main_vertex(in: VertexInput, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput {\r\n    let start = in.start;\r\n    let end = in.end;\r\n    let color = in.color;\r\n    let stroke_width = in.stroke_width;\r\n\r\n    // normalize() on a zero-length segment returns NaN\r\n    let delta = end - start;\r\n    let seg_len = length(delta);\r\n    let direction = select(vec2<f32>(1.0, 0.0), delta / seg_len, seg_len > 1e-6);\r\n    // Calculate the normal vector\r\n    let normal = vec2<f32>(-direction.y, direction.x);\r\n\r\n    // Calculate the offset for width\r\n    let adjusted_width = stroke_width + smooth_step;\r\n    let offset = normal * ((adjusted_width) * 0.5);\r\n\r\n    // Calculate the four points of the line\r\n    var p1 = start - offset;\r\n    var p2 = start + offset;\r\n    var p3 = end - offset;\r\n    var p4 = end + offset;\r\n\r\n    var vertices = array(p1, p2, p3, p2, p4, p3);\r\n    var uvs = array(\r\n        vec2<f32>(0.0, 0.0),\r\n        vec2<f32>(1.0, 0.0),\r\n        vec2<f32>(0.0, 1.0),\r\n        vec2<f32>(1.0, 0.0),\r\n        vec2<f32>(1.0, 1.0),\r\n        vec2<f32>(0.0, 1.0)\r\n    );\r\n    var pos = vertices[vertexIndex];\r\n    pos = (pos - in.offset) / in.resolution;\r\n    pos.y = 1.0 - pos.y;\r\n    pos = pos * 2.0 - 1.0;\r\n\r\n    var out: VertexOutput;\r\n    out.pos = vec4<f32>(pos, 0.0, 1.0);\r\n    out.uv = uvs[vertexIndex];\r\n    out.fill = color;\r\n    out.smooth_width = adjusted_width / stroke_width - 1.0;\r\n    return out;\r\n}\r\n\r\n@fragment\r\nfn main_fragment(in: VertexOutput) -> @location(0) vec4<f32> {\r\n    let sx = abs(in.uv.x - 0.5) * 2.0;\r\n    let sy = abs(in.uv.y - 0.5) * 2.0;\r\n    let aax: f32 = 1.0 - smoothstep(1.0 - in.smooth_width, 1.0, sx);\r\n    // let aay: f32 = 1.0 - smoothstep(1.0 - in.smooth_length, 1.0, sy);\r\n    return vec4<f32>(in.fill.rgb, in.fill.a * aax);\r\n}";

  var pathShader = "struct Uniforms {\r\n  resolution: vec2<f32>,\r\n  offset: vec2<f32>,\r\n}\r\n\r\n@group(0) @binding(0) var<uniform> uniforms : Uniforms;\r\n\r\nstruct VertexInput {\r\n  @location(0) position: vec3<f32>,\r\n  @location(1) fill_color: vec4<f32>,\r\n}\r\n\r\nstruct VertexOutput {\r\n  @builtin(position) pos: vec4<f32>,\r\n  @location(0) uv: vec2<f32>,\r\n  @location(1) fill: vec4<f32>,\r\n}\r\n\r\n@vertex\r\nfn main_vertex(\r\n    model: VertexInput\r\n) -> VertexOutput {\r\n    var output: VertexOutput;\r\n    var pos = model.position.xy - uniforms.offset;\r\n    pos = pos / uniforms.resolution;\r\n    pos.y = 1.0 - pos.y;\r\n    pos = pos * 2.0 - 1.0;\r\n    output.pos = vec4<f32>(pos, model.position.z + 0.5, 1.0);\r\n    output.uv = pos;\r\n    output.fill = model.fill_color;\r\n    return output;\r\n}\r\n\r\n@fragment\r\nfn main_fragment(in: VertexOutput) -> @location(0) vec4<f32> {\r\n    return in.fill;\r\n}\r\n";

  var rectShader = "struct Uniforms {\r\n  resolution: vec2<f32>,\r\n  offset: vec2<f32>,\r\n};\r\n\r\n@group(0) @binding(0) var<uniform> uniforms : Uniforms;\r\n\r\nstruct VertexInput {\r\n  @location(0) position: vec2<f32>,\r\n}\r\n\r\nstruct InstanceInput {\r\n  @location(1) center: vec2<f32>,\r\n  @location(2) scale: vec2<f32>,\r\n  @location(3) fill_color: vec4<f32>,\r\n  @location(4) stroke_color: vec4<f32>,\r\n  @location(5) strokewidth: f32,\r\n  @location(6) corner_radii: vec4<f32>,\r\n}\r\n\r\nstruct VertexOutput {\r\n  @builtin(position) pos: vec4<f32>,\r\n  @location(0) uv: vec2<f32>,\r\n  @location(1) fill: vec4<f32>,\r\n  @location(2) stroke: vec4<f32>,\r\n  @location(3) strokewidth: f32,\r\n  @location(4) corner_radii: vec4<f32>,\r\n  @location(5) scale: vec2<f32>,\r\n}\r\n\r\n@vertex\r\nfn main_vertex(\r\n    model: VertexInput,\r\n    instance: InstanceInput\r\n) -> VertexOutput {\r\n    var output: VertexOutput;\r\n    var u = uniforms.resolution;\r\n    var scale = instance.scale + vec2<f32>(instance.strokewidth, instance.strokewidth);\r\n    var pos = model.position * scale + instance.center - uniforms.offset - vec2<f32>(instance.strokewidth, instance.strokewidth) / 2.0;\r\n    pos = pos / u;\r\n    pos.y = 1.0 - pos.y;\r\n    pos = pos * 2.0 - 1.0;\r\n    output.pos = vec4<f32>(pos, 0.0, 1.0);\r\n    output.uv = vec2<f32>(model.position.x, 1.0 - model.position.y);\r\n    output.fill = instance.fill_color;\r\n    output.stroke = instance.stroke_color;\r\n    output.strokewidth = instance.strokewidth;\r\n    output.corner_radii = instance.corner_radii;\r\n    output.scale = instance.scale;\r\n    return output;\r\n}\r\n\r\n// Signed distance to the rect edge with per-corner radii.\r\n// p is centered on the rect in pixels (y up), b is the half extent.\r\n// corner_radii = (topRight, bottomRight, bottomLeft, topLeft).\r\nfn sdRoundedRect(p: vec2<f32>, b: vec2<f32>, radii: vec4<f32>) -> f32 {\r\n    var r = select(\r\n        select(radii.z, radii.w, p.y > 0.0), // left: TL above center, BL below\r\n        select(radii.y, radii.x, p.y > 0.0), // right: TR above center, BR below\r\n        p.x > 0.0,\r\n    );\r\n    r = min(r, min(b.x, b.y));\r\n    let q = abs(p) - b + vec2<f32>(r, r);\r\n    return length(max(q, vec2<f32>(0.0, 0.0))) + min(max(q.x, q.y), 0.0) - r;\r\n}\r\n\r\n// Blends fill and stroke along the rounded edge. The stroke straddles the\r\n// nominal edge like canvas strokes do. `aa` is the antialiasing width.\r\nfn roundedRectColor(in: VertexOutput, fill: vec4<f32>) -> vec4<f32> {\r\n    let p = (in.uv - vec2<f32>(0.5, 0.5)) * (in.scale + vec2<f32>(in.strokewidth, in.strokewidth));\r\n    let d = sdRoundedRect(p, in.scale * 0.5, in.corner_radii);\r\n    let half_sw = in.strokewidth * 0.5;\r\n    let aa = 0.75;\r\n\r\n    let strokeMix = smoothstep(-half_sw - aa, -half_sw + aa, d);\r\n    let coverage = 1.0 - smoothstep(half_sw - aa, half_sw + aa, d);\r\n    var col = mix(fill, in.stroke, strokeMix);\r\n    return vec4<f32>(col.rgb, col.a * coverage);\r\n}\r\n\r\nfn straightRectColor(in: VertexOutput, fill: vec4<f32>) -> vec4<f32> {\r\n    var col = fill;\r\n    // uv spans the quad enlarged by strokewidth (see main_vertex), so the\r\n    // stroke band fraction must divide by that enlarged size to keep the\r\n    // stroke exactly strokewidth px wide, centered on the rect edge.\r\n    let sw: vec2<f32> = vec2<f32>(in.strokewidth, in.strokewidth) / (in.scale + vec2<f32>(in.strokewidth, in.strokewidth));\r\n    if in.uv.x < sw.x || in.uv.x > 1.0 - sw.x {\r\n        col = in.stroke;\r\n    }\r\n    if in.uv.y < sw.y || in.uv.y > 1.0 - sw.y {\r\n        col = in.stroke;\r\n    }\r\n    return col;\r\n}\r\n\r\nfn maxRadius(radii: vec4<f32>) -> f32 {\r\n    return max(max(radii.x, radii.y), max(radii.z, radii.w));\r\n}\r\n\r\n@fragment\r\nfn main_fragment(in: VertexOutput) -> @location(0) vec4<f32> {\r\n    if maxRadius(in.corner_radii) <= 0.0 {\r\n        return straightRectColor(in, in.fill);\r\n    }\r\n    return roundedRectColor(in, in.fill);\r\n}\r\n\r\n// Gradient-filled rects: the fill is sampled from a baked stop ramp.\r\n// coords = (x1, y1, x2, y2) normalized to the rect (y down),\r\n// misc = (kind, r1, r2, unused). kind: 1 = linear, 2 = radial.\r\nstruct GradientParams {\r\n  coords: vec4<f32>,\r\n  bounds: vec4<f32>,\r\n  misc: vec4<f32>,\r\n}\r\n\r\n@group(1) @binding(0) var stopSampler: sampler;\r\n@group(1) @binding(1) var stopRamp: texture_2d<f32>;\r\n@group(1) @binding(2) var<uniform> gradient: GradientParams;\r\n\r\n// p is normalized to the rect, wh is the rect size in pixels.\r\n// Linear gradients evaluate in normalized space (matching vega's canvas\r\n// renderer). Radial gradients are circular in pixel space with radii\r\n// scaled by max(w, h).\r\nfn gradientT(p: vec2<f32>, wh: vec2<f32>) -> f32 {\r\n    if gradient.misc.x < 1.5 {\r\n        let a = gradient.coords.xy;\r\n        let b = gradient.coords.zw;\r\n        let ab = b - a;\r\n        let len2 = max(dot(ab, ab), 1e-6);\r\n        return clamp(dot(p - a, ab) / len2, 0.0, 1.0);\r\n    }\r\n    // radial: concentric-circle approximation around (x2, y2)\r\n    let m = max(wh.x, wh.y);\r\n    let c = gradient.coords.zw * wh;\r\n    let r1 = gradient.misc.y * m;\r\n    let r2 = gradient.misc.z * m;\r\n    return clamp((distance(p * wh, c) - r1) / max(r2 - r1, 1e-6), 0.0, 1.0);\r\n}\r\n\r\n@fragment\r\nfn main_fragment_gradient(in: VertexOutput) -> @location(0) vec4<f32> {\r\n    // un-flip: gradient coordinates run top-down like canvas coordinates\r\n    let p = vec2<f32>(in.uv.x, 1.0 - in.uv.y);\r\n    let t = gradientT(p, in.scale);\r\n    let sample = textureSample(stopRamp, stopSampler, vec2<f32>(t, 0.5));\r\n    let fill = vec4<f32>(sample.rgb, sample.a * in.fill.a);\r\n\r\n    if maxRadius(in.corner_radii) <= 0.0 {\r\n        return straightRectColor(in, fill);\r\n    }\r\n    return roundedRectColor(in, fill);\r\n}\r\n";

  var ruleShader = "struct Uniforms {\r\n    resolution: vec2<f32>,\r\n    offset: vec2<f32>,\r\n}\r\n\r\n@group(0) @binding(0) var<uniform> uniforms: Uniforms;\r\n\r\nstruct VertexInput {\r\n    @location(0) position: vec2<f32>,\r\n    @location(1) center: vec2<f32>,\r\n    @location(2) scale: vec2<f32>,\r\n    @location(3) stroke_color: vec4<f32>,\r\n    @location(4) axis_offset: vec2<f32>,\r\n}\r\n\r\nstruct VertexOutput {\r\n    @builtin(position) pos: vec4<f32>,\r\n    @location(1) stroke: vec4<f32>,\r\n}\r\n\r\n@vertex\r\nfn main_vertex(in: VertexInput) -> VertexOutput {\r\n    var output : VertexOutput;\r\n    var u = uniforms.resolution;\r\n    var pos = in.position * in.scale + in.center - uniforms.offset - in.axis_offset;\r\n    pos = pos / uniforms.resolution;\r\n    pos.y = 1.0 - pos.y;\r\n    pos = pos * 2.0 - 1.0;\r\n    output.pos = vec4<f32>(pos, 0.0, 1.0);\r\n    output.stroke = in.stroke_color;\r\n    return output;\r\n}\r\n\r\n@fragment\r\nfn main_fragment(in: VertexOutput) -> @location(0) vec4<f32> {\r\n    return in.stroke;\r\n}\r\n";

  var shapeShader = "struct Uniforms {\r\n  resolution: vec2<f32>,\r\n  offset: vec2<f32>,\r\n}\r\n\r\n@group(0) @binding(0) var<uniform> uniforms : Uniforms;\r\n\r\nstruct VertexInput {\r\n  @location(0) position: vec3<f32>,\r\n  @location(1) fill_color: vec4<f32>,\r\n}\r\n\r\nstruct VertexOutput {\r\n  @builtin(position) pos: vec4<f32>,\r\n  @location(0) uv: vec2<f32>,\r\n  @location(1) fill: vec4<f32>,\r\n}\r\n\r\n@vertex\r\nfn main_vertex(\r\n    model: VertexInput,\r\n) -> VertexOutput {\r\n    var output: VertexOutput;\r\n    var pos = model.position.xy - uniforms.offset;\r\n    pos = pos / uniforms.resolution;\r\n    pos.y = 1.0 - pos.y;\r\n    pos = pos * 2.0 - 1.0;\r\n    output.pos = vec4<f32>(pos, model.position.z + 0.5, 1.0);\r\n    output.uv = pos;\r\n    output.fill = model.fill_color;\r\n    return output;\r\n}\r\n\r\n@fragment\r\nfn main_fragment(in: VertexOutput) -> @location(0) vec4<f32> {\r\n    return in.fill;\r\n}\r\n";

  var slineShader = "struct Uniforms {\r\n    resolution: vec2<f32>,\r\n    offset: vec2<f32>,\r\n};\r\n\r\n@group(0) @binding(0) var<uniform> uniforms: Uniforms;\r\n\r\nstruct VertexInput {\r\n    @location(0) start: vec2<f32>,\r\n    @location(1) end: vec2<f32>,\r\n    @location(2) color: vec4<f32>,\r\n    @location(3) stroke_width: f32,\r\n};\r\n\r\n\r\nstruct VertexOutput {\r\n    @builtin(position) pos: vec4<f32>,\r\n    @location(0) fill: vec4<f32>,\r\n};\r\n\r\n@vertex\r\nfn main_vertex(in: VertexInput, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput {\r\n    let start = in.start;\r\n    let end = in.end;\r\n    let color = in.color;\r\n    let stroke_width = in.stroke_width;\r\n\r\n    // normalize() on a zero-length segment returns NaN\r\n    let delta = end - start;\r\n    let seg_len = length(delta);\r\n    let direction = select(vec2<f32>(1.0, 0.0), delta / seg_len, seg_len > 1e-6);\r\n\r\n    // Calculate the normal vector\r\n    let normal = vec2<f32>(-direction.y, direction.x);\r\n\r\n    // Calculate the offset for width\r\n    let offset = normal * ((stroke_width) * 0.5);\r\n\r\n    // Calculate the four points of the line\r\n    var p1 = start - offset;\r\n    var p2 = start + offset;\r\n    var p3 = end - offset;\r\n    var p4 = end + offset;\r\n\r\n    var vertices = array(p1, p2, p3, p4, p2, p3);\r\n    var pos = vertices[vertexIndex];\r\n    pos = (pos - uniforms.offset) / uniforms.resolution;\r\n    pos.y = 1.0 - pos.y;\r\n    pos = pos * 2.0 - 1.0;\r\n\r\n    var out: VertexOutput;\r\n    out.pos = vec4<f32>(pos, 0.0, 1.0);\r\n    out.fill = color;\r\n    return out;\r\n}\r\n\r\n@fragment\r\nfn main_fragment(in: VertexOutput) -> @location(0) vec4<f32> {\r\n    return in.fill;\r\n}";

  var symbolShader = "struct Uniforms {\r\n  resolution: vec2<f32>,\r\n  offset: vec2<f32>,\r\n}\r\n\r\n@group(0) @binding(0) var<uniform> uniforms : Uniforms;\r\n\r\nstruct VertexInput {\r\n  @location(0) position: vec2<f32>,\r\n}\r\n\r\nstruct InstanceInput {\r\n  @location(1) center: vec2<f32>,\r\n  @location(2) radius: f32,\r\n  @location(3) fill_color: vec4<f32>,\r\n  @location(4) stroke_color: vec4<f32>,\r\n  @location(5) stroke_width: f32,\r\n}\r\n\r\nstruct VertexOutput {\r\n  @builtin(position) pos: vec4<f32>,\r\n  @location(0) uv: vec2<f32>,\r\n  @location(1) fill: vec4<f32>,\r\n  @location(2) stroke_color: vec4<f32>,\r\n  @location(3) radius: f32,\r\n  @location(4) stroke_width: f32,\r\n  @location(5) geom_radius: f32,\r\n}\r\n\r\n// Antialiasing half-width (px) and extra geometry padding so the analytic\r\n// circle edge fades out inside the tessellated geometry.\r\nconst aa = 0.75;\r\nconst pad = 1.0;\r\n\r\n@vertex\r\nfn main_vertex(\r\n    model: VertexInput,\r\n    instance: InstanceInput\r\n) -> VertexOutput {\r\n    var output: VertexOutput;\r\n    // The stroke straddles the fill radius, so the geometry must reach the\r\n    // outer stroke edge (radius + stroke_width/2) plus AA padding.\r\n    let geom_radius = instance.radius + instance.stroke_width * 0.5 + pad;\r\n    var pos = model.position * geom_radius + instance.center - uniforms.offset;\r\n    pos = pos / uniforms.resolution;\r\n    pos.y = 1.0 - pos.y;\r\n    pos = pos * 2.0 - 1.0;\r\n    output.pos = vec4<f32>(pos, 0.0, 1.0);\r\n    output.uv = model.position * 0.5 + vec2<f32>(0.5, 0.5);\r\n    output.fill = instance.fill_color;\r\n    output.stroke_color = instance.stroke_color;\r\n    output.radius = instance.radius;\r\n    output.stroke_width = instance.stroke_width;\r\n    output.geom_radius = geom_radius;\r\n    return output;\r\n}\r\n\r\n@fragment\r\nfn main_fragment(in: VertexOutput) -> @location(0) vec4<f32> {\r\n    // distance from the symbol center, in pixels\r\n    let d = distance(in.uv, vec2<f32>(0.5, 0.5)) * 2.0 * in.geom_radius;\r\n    let half_sw = in.stroke_width * 0.5;\r\n    let outer = in.radius + half_sw;\r\n    let inner = in.radius - half_sw;\r\n    // coverage fades at the outer edge, stroke replaces fill outside `inner`\r\n    let coverage = 1.0 - smoothstep(outer - aa, outer + aa, d);\r\n    let strokeMix = smoothstep(inner - aa, inner + aa, d);\r\n    let col = mix(in.fill, in.stroke_color, strokeMix);\r\n    return vec4<f32>(col.rgb, col.a * coverage);\r\n}\r\n";

  var symbolShapeShader = "// Instanced triangulated symbol shapes: one triangulated geometry per\r\n// (shape, size), placed and colored per instance. Circles use the analytic\r\n// symbol.wgsl shader instead. Everything else comes through here.\r\nstruct Uniforms {\r\n  resolution: vec2<f32>,\r\n  offset: vec2<f32>,\r\n}\r\n\r\n@group(0) @binding(0) var<uniform> uniforms: Uniforms;\r\n\r\nstruct VertexInput {\r\n  @location(0) position: vec2<f32>,\r\n}\r\n\r\nstruct InstanceInput {\r\n  @location(1) center: vec2<f32>,\r\n  @location(2) color: vec4<f32>,\r\n  @location(3) angle: f32, // radians, clockwise (screen space)\r\n}\r\n\r\nstruct VertexOutput {\r\n  @builtin(position) pos: vec4<f32>,\r\n  @location(0) color: vec4<f32>,\r\n}\r\n\r\n@vertex\r\nfn main_vertex(model: VertexInput, instance: InstanceInput) -> VertexOutput {\r\n  let c = cos(instance.angle);\r\n  let s = sin(instance.angle);\r\n  let rotated = vec2<f32>(model.position.x * c - model.position.y * s, model.position.x * s + model.position.y * c);\r\n  var pos = rotated + instance.center - uniforms.offset;\r\n  pos = pos / uniforms.resolution;\r\n  pos.y = 1.0 - pos.y;\r\n  pos = pos * 2.0 - 1.0;\r\n  var output: VertexOutput;\r\n  output.pos = vec4<f32>(pos, 0.0, 1.0);\r\n  output.color = instance.color;\r\n  return output;\r\n}\r\n\r\n@fragment\r\nfn main_fragment(in: VertexOutput) -> @location(0) vec4<f32> {\r\n  return in.color;\r\n}\r\n";

  var textShader = "struct Uniforms {\r\n  resolution: vec2<f32>,\r\n  offset: vec2<f32>,\r\n  opacity: f32,\r\n}\r\n\r\n@group(0) @binding(0) var<uniform> uniforms: Uniforms;\r\n@group(1) @binding(0) var texSampler: sampler;\r\n@group(1) @binding(1) var tex: texture_2d<f32>;\r\n\r\nstruct VertexInput {\r\n  @location(0) position: vec2<f32>,\r\n  @location(1) uv: vec2<f32>,\r\n}\r\n\r\nstruct VertexOutput {\r\n  @builtin(position) pos: vec4<f32>,\r\n  @location(0) uv: vec2<f32>,\r\n}\r\n\r\n@vertex\r\nfn main_vertex(in: VertexInput) -> VertexOutput {\r\n  var output: VertexOutput;\r\n  var p = in.position - uniforms.offset;\r\n  p = p / uniforms.resolution;\r\n  p.y = 1.0 - p.y;\r\n  p = p * 2.0 - 1.0;\r\n  output.pos = vec4<f32>(p, 0.0, 1.0);\r\n  output.uv = in.uv;\r\n  return output;\r\n}\r\n\r\n@fragment\r\nfn main_fragment(in: VertexOutput) -> @location(0) vec4<f32> {\r\n  // The glyph texture is rasterized with the fill/stroke colors baked in\r\n  // (straight alpha). Only the item opacity is applied here.\r\n  let c = textureSample(tex, texSampler, in.uv);\r\n  return vec4<f32>(c.rgb, c.a * uniforms.opacity);\r\n}\r\n";

  const viewBounds = (origin, width, height) => new vegaScenegraph.Bounds().set(0, 0, width, height).translate(-origin[0], -origin[1]);
  class WebGPURenderer extends vegaScenegraph.Renderer {
      wgOptions = {
          renderBatch: true,
          simpleLine: true,
          debugLog: false,
          cacheShapes: false,
          renderLock: true,
          sampleCount: defaultSampleCount,
      };
      _canvas = null;
      // Detached 2D canvas used only as a geometric scratch context for picking
      // (isPointInPath/isPointInStroke). It is never displayed. All visible
      // rendering, including text, goes through the single WebGPU canvas.
      _pickCanvas = null;
      _pickContext = null;
      _ctx = null;
      _device = null;
      _msaaTexture = null;
      _msaaTextureDevice = null;
      _queue = new RenderQueue();
      _uniforms = { resolution: [0, 0], origin: [0, 0], dpi: 1 };
      _renderCount = 0;
      _warnedTextureSize = false;
      _pendingDestroy = [];
      _isRendering = false;
      _pendingRender = null;
      _lastRender = null;
      _renderPromise = Promise.resolve();
      // Stands in for a deferred frame so awaiting callers follow it, not the
      // already-settled in-flight one.
      _pendingPromise = null;
      _resolvePending = null;
      constructor(loader) {
          super(loader);
      }
      initialize(el, width, height, origin, scaleFactor, opt) {
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
          ctx._uniforms = this._uniforms;
          ctx._tx = 0;
          ctx._ty = 0;
          ctx._origin = [0, 0];
          ctx._ratio = 1;
          ctx._sampleCount = normalizeSampleCount(this.wgOptions.sampleCount);
          ctx._shaderCache = {};
          ctx._markCache = {};
          ctx._pathCache = {};
          ctx._pathCacheSize = 0;
          ctx._geometryCache = {};
          ctx._geometryCacheSize = 0;
          this._ctx = ctx;
          this._bgcolor = '#ffffff';
          // this method will invoke resize to size the canvas appropriately
          return super.initialize(el, width, height, origin, scaleFactor, opt);
      }
      resize(width, height, origin, scaleFactor) {
          super.resize(width, height, origin, scaleFactor);
          const o = [this._origin[0], this._origin[1]];
          if (this._canvas && this._ctx && this._pickCanvas && this._pickContext) {
              resize(this._canvas, this._ctx, this._width, this._height, o, this._pickCanvas, this._pickContext, scaleFactor);
              // devicePixelRatio disagrees with this for a detached canvas or an
              // explicit scaleFactor.
              this._uniforms = {
                  resolution: [width, height],
                  origin: o,
                  dpi: this._ctx._ratio,
              };
              this._ctx._uniforms = this._uniforms;
          }
          return this;
      }
      canvas() {
          return this._canvas;
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
              device = await adapter.requestDevice();
              this._device = device;
              this._handleDeviceLoss(device);
              ctx.configure({
                  device,
                  format: preferredColorFormat(),
                  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
                  alphaMode: 'premultiplied',
              });
              this._cacheShaders(device, ctx);
          }
          return { device, ctx };
      }
      _handleDeviceLoss(device) {
          device.lost.then(info => {
              if (info.reason === 'destroyed') {
                  return;
              }
              console.warn(`[vega-webgpu] GPU device lost (${info.message}); reinitializing.`);
              this._device = null;
              this._msaaTexture = null;
              this._msaaTextureDevice = null;
              if (this._ctx) {
                  this._ctx._shaderCache = {};
                  this._ctx._markCache = {};
              }
              // re-render the last known scene with a fresh device
              if (this._lastRender) {
                  this._render(this._lastRender.scene, this._lastRender.markTypes);
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
      _render(scene, markTypes) {
          this._lastRender = { scene, markTypes };
          if (this.wgOptions.renderLock && this._isRendering) {
              // Without a stand-in promise renderAsync would resolve against the
              // in-flight frame, so callers would read the canvas before this scene ran.
              this._pendingRender = { scene, markTypes };
              if (!this._pendingPromise) {
                  this._pendingPromise = new Promise(resolve => {
                      this._resolvePending = resolve;
                  });
              }
              this._renderPromise = this._pendingPromise;
              return this;
          }
          this._isRendering = true;
          this._renderPromise = this._frame(scene, markTypes).catch(err => {
              console.error('[vega-webgpu] Render failed:', err);
              // One failure must not wedge the lock or strand awaiting callers.
              this._finishFrame();
          });
          return this;
      }
      /** Resolves when all in-flight render work has been submitted to the GPU. */
      async renderAsync(scene, markTypes) {
          this.render(scene, markTypes);
          await this._renderPromise;
          // wait for pending resource loads (images) and the re-renders they trigger
          while (this._ready) {
              await this._ready;
              await this._renderPromise;
          }
          if (this._device) {
              // A lost device rejects this. Loss is handled by _handleDeviceLoss and the
              // pixel output is the real check, so do not fail the render over it.
              await this._device.queue.onSubmittedWorkDone().catch((err) => {
                  if (this.wgOptions.debugLog === true) {
                      console.warn('[vega-webgpu] onSubmittedWorkDone rejected:', err);
                  }
              });
          }
          return this;
      }
      /** Applies a changed wgOptions.sampleCount: pipelines bake the sample
       * count, so the per-mark GPU resources and attachments are rebuilt. */
      _applySampleCount(ctx) {
          const requested = normalizeSampleCount(this.wgOptions.sampleCount);
          if (requested === ctx._sampleCount) {
              return;
          }
          ctx._sampleCount = requested;
          ctx._markCache = {};
          this._msaaTexture?.destroy();
          this._msaaTexture = null;
          this._msaaTextureDevice = null;
      }
      async _frame(scene, markTypes) {
          const { device, ctx } = await this._reinit();
          // WebGPU textures (and the swapchain) are capped at maxTextureDimension2D
          // (commonly 8192). Very tall or wide canvases, e.g. a long sorted bar list,
          // would otherwise fail attachment creation and spam validation errors.
          const maxDim = device.limits.maxTextureDimension2D;
          const cw = this._canvas?.width ?? 0;
          const chh = this._canvas?.height ?? 0;
          if (cw > maxDim || chh > maxDim) {
              if (!this._warnedTextureSize) {
                  this._warnedTextureSize = true;
                  console.warn(`[vega-webgpu] Canvas ${cw}x${chh} exceeds the GPU's maximum texture size ` +
                      `(${maxDim}px); skipping WebGPU rendering for this view. Consider the canvas ` +
                      `or svg renderer for very large outputs.`);
              }
              this._finishFrame();
              return;
          }
          this._applySampleCount(ctx);
          this._queue.startFrame();
          const o = this._origin;
          const w = this._width;
          const h = this._height;
          const vb = viewBounds([o[0], o[1]], w, h);
          ctx._tx = 0;
          ctx._ty = 0;
          const t1 = performance.now();
          this.draw(device, ctx, scene, vb, markTypes);
          const t2 = performance.now();
          // One pass for the whole frame: clears to the background color, draws
          // in scenegraph order, and resolves the MSAA attachment once.
          const renderPassDescriptor = createRenderPassDescriptor('Frame', this.clearColor());
          if (ctx._sampleCount > 1) {
              renderPassDescriptor.colorAttachments[0].view = this.msaaTexture(device).createView();
              renderPassDescriptor.colorAttachments[0].resolveTarget = ctx.getCurrentTexture().createView();
          }
          else {
              renderPassDescriptor.colorAttachments[0].view = ctx.getCurrentTexture().createView();
          }
          this._queue.submit(device, renderPassDescriptor, [this._canvas?.width ?? 0, this._canvas?.height ?? 0]);
          // rAF never fires in a hidden tab, which would wedge _isRendering.
          if (typeof document !== 'undefined' && !document.hidden) {
              requestAnimationFrame(() => this._endFrame(t1, t2));
          }
          else {
              setTimeout(() => this._endFrame(t1, t2), 0);
          }
      }
      _endFrame(t1, t2) {
          if (this.wgOptions.debugLog === true) {
              const t3 = performance.now();
              console.log(`Render Time (${this._renderCount++}): ${(t3 - t1).toFixed(3)}ms ` +
                  `(Draw: ${(t2 - t1).toFixed(3)}ms, WebGPU: ${(t3 - t2).toFixed(3)}ms)`);
          }
          this._finishFrame();
      }
      /**
       * Releases the render lock and flushes a coalesced request, if any.
       *
       * Every exit from a frame (completion, early return, or failure) must come
       * through here, or `_isRendering` stays stuck and awaiting callers never wake.
       */
      /**
       * Queues a GPU resource for destruction once the current frame is submitted.
       * Safe to call from inside a mark's draw, where the resource may still be
       * referenced by a queued but not yet encoded draw.
       */
      deferDestroy(resource) {
          this._pendingDestroy.push(resource);
      }
      _finishFrame() {
          this._isRendering = false;
          if (this._pendingDestroy.length > 0) {
              for (const resource of this._pendingDestroy) {
                  resource.destroy();
              }
              this._pendingDestroy = [];
          }
          const pending = this._pendingRender;
          this._pendingRender = null;
          const resolve = this._resolvePending;
          this._pendingPromise = null;
          this._resolvePending = null;
          if (pending) {
              this._render(pending.scene, pending.markTypes);
              // Settle only once the flushed frame does, so callers track real work.
              this._renderPromise.then(() => resolve?.(), () => resolve?.());
              return;
          }
          resolve?.();
      }
      /** Re-renders the most recent scene (e.g. after options changed). */
      frame() {
          if (this._lastRender) {
              this._render(this._lastRender.scene, this._lastRender.markTypes);
          }
          return this;
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
          mark.draw.call(this, device, ctx, scene, bounds, markTypes);
      }
      /** Multisampled color attachment, resolved into the canvas each frame. */
      msaaTexture(device) {
          const gpu = device ?? this._device;
          const canvas = this._canvas;
          if (!gpu || !canvas) {
              throw new Error('[vega-webgpu] Cannot create the MSAA texture before initialization.');
          }
          const existing = this._msaaTexture;
          if (existing &&
              this._msaaTextureDevice === gpu &&
              existing.width === canvas.width &&
              existing.height === canvas.height) {
              return existing;
          }
          existing?.destroy();
          this._msaaTexture = gpu.createTexture({
              label: 'MSAA Color Texture',
              size: [canvas.width, canvas.height, 1],
              format: preferredColorFormat(),
              dimension: '2d',
              sampleCount: this._ctx?._sampleCount ?? defaultSampleCount,
              usage: GPUTextureUsage.RENDER_ATTACHMENT,
          });
          this._msaaTextureDevice = gpu;
          return this._msaaTexture;
      }
      clearColor() {
          const bg = this._bgcolor ? Color.from(this._bgcolor) : null;
          if (!bg) {
              return { r: 1.0, g: 1.0, b: 1.0, a: 1.0 };
          }
          // The surface is configured alphaMode premultiplied, so a translucent
          // background has to be premultiplied here too or it composites too bright.
          return { r: bg.r * bg.a, g: bg.g * bg.a, b: bg.b * bg.a, a: bg.a };
      }
      _cacheShaders(device, ctx) {
          ctx._shaderCache = {
              Symbol: device.createShaderModule({ code: symbolShader, label: 'Symbol Shader' }),
              SymbolShape: device.createShaderModule({ code: symbolShapeShader, label: 'Symbol Shape Shader' }),
              Line: device.createShaderModule({ code: lineShader, label: 'Line Shader' }),
              Rule: device.createShaderModule({ code: ruleShader, label: 'Rule Shader' }),
              SLine: device.createShaderModule({ code: slineShader, label: 'SLine Shader' }),
              Path: device.createShaderModule({ code: pathShader, label: 'Path Shader' }),
              Rect: device.createShaderModule({ code: rectShader, label: 'Rect Shader' }),
              // Group backgrounds are rounded rectangles, so they reuse the rect shader.
              Group: device.createShaderModule({ code: rectShader, label: 'Group Shader' }),
              GradientFill: device.createShaderModule({ code: gradientFillShader, label: 'Gradient Fill Shader' }),
              Image: device.createShaderModule({ code: imageShader, label: 'Image Shader' }),
              Text: device.createShaderModule({ code: textShader, label: 'Text Shader' }),
              Shape: device.createShaderModule({ code: shapeShader, label: 'Shape Shader' }),
              Area: device.createShaderModule({ code: areaShader, label: 'Area Shader' }),
          };
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

  exports.WebGPURenderer = WebGPURenderer;

}));
//# sourceMappingURL=vega-webgpu-renderer.js.map
