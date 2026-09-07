import { pathTrail, pathCurves, pathSymbols, Marks, Bounds, Renderer, domClear, CanvasHandler, renderModule, CanvasRenderer } from 'vega-scenegraph';
import parse$1 from 'parse-svg-path';
import simplify from 'simplify-path';
import contours from 'svg-path-contours';
import triangulate from 'triangulate-contours';
import extrude from 'extrude-polyline';
import { color } from 'd3-color';

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

const EMPTY = { lines: [], triangles: [], closed: false, z: 0 };
let warnedTessellation = false;
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
/**
 * Triangulates an SVG path string into fill triangles and outline contours.
 * Results are cached on the context, keyed by the path string.
 *
 * `threshold` is the Douglas-Peucker tolerance in pixels. At 1.0 a gentle
 * curve collapses into visible facets, which is what an isocontour is made of.
 */
function geometryForPath(context, path, threshold = 0.1) {
    if (!path) {
        return EMPTY;
    }
    const cacheKey = `${threshold}|${path}`;
    const cached = context._pathCache[cacheKey];
    if (cached !== undefined) {
        return cached;
    }
    // get a list of polylines/contours from svg contents
    const flat = contours(parse$1(path));
    let lines = flat.map(contour => simplify(contour, threshold));
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
        tri = { positions: [], cells: [] };
        if (!warnedTessellation) {
            warnedTessellation = true;
            console.warn('[vega-webgpu] A path could not be tessellated and is not drawn.');
        }
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
// vega's own trail accessor, which is `size` and not the item's extent
const ts = (item) => item.size || 1;
const cr = (item) => item.cornerRadius || 0;
const pa = (item) => item.padAngle || 0;
const def = (item) => item.defined !== false;
const arcShape = d3_arc().cornerRadius(cr).padAngle(pa);
const areavShape = d3_area().x(x).y1(y).y0(yh).defined(def);
const areahShape = d3_area().y(y).x1(x).x0(xw).defined(def);
const trailShape = pathTrail().x(x).y(y).defined(def).size(ts);
const lineShape = d3_line().x(x).y(y).defined(def);
function arc$1(context, item) {
    return geometryForPath(context, arcShape.context(null)(item) ?? '');
}
function area$1(context, items) {
    const item = items[0];
    const interp = item.interpolate || 'linear';
    const path = interp === 'trail'
        ? trailShape.context(null)(items)
        : (item.orient === 'horizontal' ? areahShape : areavShape)
            .curve(pathCurves(interp, item.orient, item.tension))
            .context(null)(items);
    return geometryForPath(context, path ?? '');
}
/**
 * Path geometry for a trail mark: one filled ribbon whose width follows each
 * point's `size`, which is what vega's own trail mark draws.
 */
function trail$1(context, items) {
    return geometryForPath(context, trailShape.context(null)(items) ?? '');
}
/**
 * Path geometry for a line mark, honouring `interpolate`, `tension` and the
 * `defined` gaps. Used when the line is not a plain polyline.
 */
function line$1(context, items) {
    const item = items[0];
    const curve = pathCurves(item.interpolate || 'linear', item.orient, item.tension);
    return geometryForPath(context, lineShape.curve(curve).context(null)(items) ?? '');
}
/**
 * Runs the line generator straight into `sink`, so a caller that wants the
 * curve's own control points gets them without a path string in between.
 */
function lineSpans(items, sink) {
    const item = items[0];
    const curve = pathCurves(item.interpolate || 'linear', item.orient, item.tension);
    lineShape.curve(curve).context(sink)(items);
    lineShape.context(null);
}
function shape$1(context, item) {
    const generator = (item.mark.shape ?? item.shape);
    return geometryForPath(context, generator.context(null)(item) ?? '');
}
/**
 * Triangulated geometry for a vega symbol shape (square, cross, diamond,
 * triangle-*, arrow, wedge, stroke, or a custom SVG path) at the given size,
 * centered on the origin. `size` is the symbol area, matching the canvas
 * renderer's `pathSymbols` sizing.
 */
function symbol$1(context, shapeName, size) {
    const type = pathSymbols(shapeName || 'circle');
    const path = Symbol$1(type, size).context(null)() ?? '';
    return geometryForPath(context, path);
}

// canvas defaults to 10; a miter is never further from the contour than this
// many line widths, which is what bounds the spikes below
const MITER_LIMIT = 10;
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
    if (Math.hypot(ring[0][0] - last[0], ring[0][1] - last[1]) > 1e-9) {
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
    const opacity = item.opacity ?? 1;
    let fillOpacity = opacity * (item.fillOpacity ?? 1);
    let strokeOpacity = opacity * (item.strokeOpacity ?? 1);
    const fillTriangleCoords = shapeGeom.triangles;
    let z = shapeGeom.z;
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
    const key = shapeGeom.key === undefined
        ? undefined
        : `${shapeGeom.key}|${lineWidth}|${lineCap}|${dx}|${dy}|${angle}|${scaleX}|${scaleY}|${fill ? 1 : 0}|${strokeOn ? 1 : 0}`;
    if (cache && key !== undefined) {
        const entry = context._geometryCache[key];
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
    const fillVertexCount = fill ? fillTriangleCoords.length / 3 : 0;
    const strokeMeshes = [];
    let strokeCellCount = 0;
    if (strokeOn) {
        const strokeExtrude = extrude({
            thickness: lineWidth,
            cap: lineCap,
            join: 'miter',
            // at 1 almost every corner is bevel-cut
            miterLimit: MITER_LIMIT,
            closed: false,
        });
        const pad = MITER_LIMIT * lineWidth;
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
    const triangles = new Float32Array(fillVertexCount * 3);
    const strokeTriangles = new Float32Array(strokeCellCount * 3 * 3);
    if (fill) {
        for (let i = 0; i < fillTriangleCoords.length; i += 3) {
            rotateInto(fillTriangleCoords[i] * scaleX, fillTriangleCoords[i + 1] * scaleY, triangles, i);
            triangles[i + 2] = fillTriangleCoords[i + 2];
        }
    }
    let strokeVertexCount = 0;
    if (strokeMeshes.length > 0) {
        // strokes render slightly in front of fills
        z = -0.1;
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
                    rotateInto(p[0], p[1], strokeTriangles, i * 3);
                    strokeTriangles[i * 3 + 2] = z;
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

// A scene has few distinct group offsets, so this collapses to a handful.
const MAX_UNIFORM_CACHE = 128;
/**
 * Buffers a frame's draws create, released once the frame is submitted.
 *
 * A mark mints a buffer per draw and WebGPU frees none of them on its own, so
 * a hovered chart was creating hundreds a frame and holding every one, which
 * reached tens of gigabytes. Destroying is safe after submit: an implementation
 * keeps a buffer alive until the commands referencing it have run.
 */
class FrameBuffers {
    current = [];
    previous = [];
    hold(buffer) {
        this.current.push(buffer);
        return buffer;
    }
    /**
     * Frees the frame before last. A capture and an image that finishes loading
     * both submit again around a frame, so a buffer is only let go once a later
     * frame has been through as well.
     */
    release() {
        for (const buffer of this.previous) {
            buffer.destroy();
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
class BufferManager {
    device;
    uniformCache = new Map();
    bufferName;
    resolution;
    offset;
    dpi = 1;
    constructor(device, bufferName = 'Unknown', resolution = [0, 0], offset = [0, 0]) {
        this.device = device;
        this.bufferName = bufferName;
        this.resolution = resolution;
        this.offset = offset;
    }
    createUniformBuffer(data, usage = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST) {
        const values = data ?? this.uniformValues();
        return this.createBuffer(`${this.bufferName} Uniform Buffer`, values, usage);
    }
    /**
     * Uniform buffer for the current resolution and offset, reused across draws
     * that share them. Marks that draw many times per frame would otherwise mint
     * one per draw. Keyed by the values rather than shared outright, because the
     * render queue defers every draw to the end of the frame: one buffer rewritten
     * per group would hand every draw the last group's offset.
     */
    sharedUniformBuffer() {
        const values = this.uniformValues();
        const key = values.join(',');
        let buffer = this.uniformCache.get(key);
        if (!buffer) {
            // cached across frames by value, so it cannot come from the frame pool
            buffer = this.createBuffer(`${this.bufferName} Uniform`, values, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, true);
            if (this.uniformCache.size >= MAX_UNIFORM_CACHE) {
                const oldest = this.uniformCache.keys().next().value;
                if (oldest !== undefined) {
                    this.uniformCache.delete(oldest);
                }
            }
            this.uniformCache.set(key, buffer);
        }
        return buffer;
    }
    createGeometryBuffer(data, usage = GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, lasting = false) {
        return this.createBuffer(`${this.bufferName} Geometry Buffer`, data, usage, lasting);
    }
    createInstanceBuffer(data, usage = GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST) {
        return this.createBuffer(`${this.bufferName} Instance Buffer`, data, usage);
    }
    /**
     * Uploads through the queue rather than mappedAtCreation. A mapped range
     * costs one JS ArrayBuffer per buffer and a frame creates a buffer per mark,
     * which exhausts that allocation on a memory-constrained runner: every
     * create then throws "size (32) is too large for the implementation".
     */
    /**
     * `lasting` keeps the buffer out of the frame pool, for the few that are held
     * across frames rather than rebuilt.
     */
    createBuffer(name, data, usage, lasting = false) {
        const size = (data.byteLength + 3) & -4;
        const buffer = this.device.createBuffer({ label: name, size, usage });
        if (!lasting) {
            bufferPool(this.device).hold(buffer);
        }
        const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        // writeBuffer copies whole words, so an unaligned tail needs padding
        let src = bytes;
        if (size !== data.byteLength) {
            src = new Uint8Array(size);
            src.set(bytes);
        }
        this.device.queue.writeBuffer(buffer, 0, src, 0, size);
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
    setDpi(dpi) {
        this.dpi = dpi || 1;
    }
    /** The shared uniform block: resolution, group offset and device pixel ratio. */
    uniformValues() {
        return new Float32Array([...this.resolution, ...this.offset, this.dpi, 0, 0, 0]);
    }
}

/**
 * Vega's `blend` maps onto canvas `globalCompositeOperation`. WebGPU has fixed
 * function blending rather than a programmable one, so only the modes that fall
 * out of its factors and operations can be honoured: multiply, screen, darken
 * and lighten. The rest (overlay, difference, hue and friends) need the
 * destination inside the shader, which WebGPU cannot do without a copy.
 *
 * These are exact for an opaque mark, which is what a blend is nearly always
 * used on. Blending a translucent mark also needs the source weighted by its
 * own alpha, and one set of factors cannot express both.
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
const warned = new Set();
/** Normalizes a mark's blend to one this renderer keys a pipeline by. */
function blendKey(blend) {
    if (!blend || blend === 'source-over') {
        return 'normal';
    }
    if (Object.hasOwn(SUPPORTED, blend)) {
        return blend;
    }
    if (!warned.has(blend)) {
        warned.add(blend);
        console.warn(`[vega-webgpu] Blend mode '${blend}' needs the destination in the shader, which WebGPU cannot ` +
            `provide; drawing it normally. multiply, screen, darken and lighten are supported.`);
    }
    return 'normal';
}
function blendState(key) {
    return SUPPORTED[key] ?? NORMAL;
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
    /**
     * Writes the colour straight into `out` at `index`, which is what a per item
     * attribute loop wants: from2 allocates a fresh array on every call, and a
     * mark resolves a fill and a stroke for each of its items on every frame.
     */
    static write(out, index, value, opacity = 1.0, fsOpacity = 1.0) {
        if (value instanceof Color) {
            out[index] = value.values[0];
            out[index + 1] = value.values[1];
            out[index + 2] = value.values[2];
            out[index + 3] = value.values[3];
            return;
        }
        const rgba = Color.resolve(value);
        out[index] = rgba[0];
        out[index + 1] = rgba[1];
        out[index + 2] = rgba[2];
        out[index + 3] = rgba[3] * opacity * fsOpacity;
    }
    /** The colour's unscaled rgba, cached per string. */
    static resolve(value) {
        if (value == null || value === 'transparent') {
            return TRANSPARENT;
        }
        if (isGradient(value)) {
            if (!warnedGradient) {
                warnedGradient = true;
                console.warn('[vega-webgpu] A gradient stroke is only sampled where the mark triangulates it.');
            }
            return GRADIENT_FALLBACK;
        }
        let rgba = Color.cache[value];
        if (rgba === undefined) {
            rgba = parse(value);
            Color.cache[value] = rgba;
        }
        return rgba;
    }
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
function createRenderPipeline(name, device, shader, format, sampleCount, buffers, layout, fragmentEntryPoint = 'main_fragment', blend) {
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
                    blend: blend ?? {
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

/**
 * Splits a polyline into the drawn runs of a dash pattern, matching the canvas
 * setLineDash semantics: an odd-length pattern repeats to make it even, and the
 * offset skips into the pattern before the first point.
 *
 * Returns one polyline per drawn run, so callers can render them as ordinary
 * line segments.
 */
function dashPolyline(points, pattern, offset = 0) {
    const dashes = normalizePattern(pattern);
    if (dashes === null || points.length < 2) {
        return points.length >= 2 ? [points] : [];
    }
    const total = dashes.reduce((a, b) => a + b, 0);
    let index = 0;
    let remaining = dashes[0];
    let on = true;
    // Wind the pattern forward by the offset before drawing anything.
    let skip = ((offset % total) + total) % total;
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
    return runs;
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

/**
 * WGSL every shader shares, and the machinery that specializes a shader for a
 * blend mode. Sources are built in TypeScript so a variant is a string the
 * registry composes, rather than one file per combination.
 */
/**
 * The group 0 uniform block. Every mark shader binds one, and `extra` names
 * the trailing f32 fields a particular mark adds.
 */
function uniformBlock(...extra) {
    const fields = ['resolution: vec2<f32>', 'offset: vec2<f32>', ...extra.map(name => `${name}: f32`)];
    return `struct Uniforms { ${fields.join(',\n  ')}, } @group(0) @binding(0) var<uniform> uniforms: Uniforms;`;
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
    return `@fragment fn ${entryPoint}(in: VertexOutput) -> @location(0) vec4<f32> { let c = ${colorFn}(in); if c.a <= 0.0 { discard; } return blendAdjust(c); }`;
}
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
    return [prelude, ...Object.entries(entries).map(([name, fn]) => fragmentEntry(name, fn))].join('\n\n');
}
const DEFAULT_ENTRY = { main_fragment: 'fragmentColor' };
/** A segment direction that survives a zero-length segment, and its normal. */
const SEGMENT_NORMAL = `fn safeDirection(d: vec2<f32>) -> vec2<f32> { return select(vec2<f32>(1.0, 0.0), normalize(d), length(d) > 1e-9); } fn normalAt(d: vec2<f32>) -> vec2<f32> { let dir = safeDirection(d); return vec2<f32>(-dir.y, dir.x); }`;
/**
 * Fill and stroke each take their true share of the pixel, given the fraction
 * inside each edge. Thresholding instead would hand the whole pixel to one of
 * them, which drops the inner half of any stroke thin enough to straddle a
 * pixel boundary.
 */
const FILL_STROKE_SHARE = `fn fillStrokeShare(fill: vec4<f32>, stroke: vec4<f32>, inner: f32, outer: f32) -> vec4<f32> { let fa = fill.a * inner; let sa = stroke.a * max(outer - inner, 0.0); let a = fa + sa; return vec4<f32>((fill.rgb * fa + stroke.rgb * sa) / max(a, 1e-6), a); }`;
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

/**
 * Sub-segments each span is split into, and the vertex count a curve draw
 * asks for. Measured against canvas: 8 and 16 are indistinguishable and cost
 * the same, 4 is visibly worse.
 */
const CURVE_SUBDIVISIONS = 8;
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
    return ` ${uniformBlock('dpi')} ${TO_NDC} struct InstanceInput { @location(0) p0: vec2<f32>, @location(1) p1: vec2<f32>, @location(2) p2: vec2<f32>, @location(3) p3: vec2<f32>, @location(4) color: vec4<f32>, @location(5) stroke_width: f32, @location(6) kind: f32, } struct VertexOutput { @builtin(position) pos: vec4<f32>, @location(0) color: vec4<f32>, @location(1) across: f32, @location(2) half_width: f32, } const K: u32 = ${CURVE_SUBDIVISIONS}u; fn curveAt(p0: vec2<f32>, p1: vec2<f32>, p2: vec2<f32>, p3: vec2<f32>, t: f32) -> vec2<f32> { ${curve.at} } fn curveTangent(p0: vec2<f32>, p1: vec2<f32>, p2: vec2<f32>, p3: vec2<f32>, t: f32) -> vec2<f32> { ${curve.tangent} } fn spanTangent(p0: vec2<f32>, p1: vec2<f32>, p2: vec2<f32>, p3: vec2<f32>, t: f32) -> vec2<f32> { let d = curveTangent(p0, p1, p2, p3, t); return select(p3 - p0, d, length(d) > 1e-6); } ${SEGMENT_NORMAL} @vertex fn main_vertex(instance: InstanceInput, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput { let sub = vertexIndex / 6u; let corner = vertexIndex % 6u; let straight = instance.kind > 0.5; var a: vec2<f32>; var b: vec2<f32>; var na: vec2<f32>; var nb: vec2<f32>; if straight { if sub > 0u { var out: VertexOutput; out.pos = vec4<f32>(0.0, 0.0, 0.0, 1.0); out.color = vec4<f32>(0.0, 0.0, 0.0, 0.0); out.across = 0.0; out.half_width = 1.0; return out; } a = instance.p0; b = instance.p1; na = normalAt(b - a); nb = na; } else { let t0 = f32(sub) / f32(K); let t1 = f32(sub + 1u) / f32(K); a = curveAt(instance.p0, instance.p1, instance.p2, instance.p3, t0); b = curveAt(instance.p0, instance.p1, instance.p2, instance.p3, t1); na = normalAt(spanTangent(instance.p0, instance.p1, instance.p2, instance.p3, t0)); nb = normalAt(spanTangent(instance.p0, instance.p1, instance.p2, instance.p3, t1)); } let half = instance.stroke_width * 0.5 + 1.0; var point: vec2<f32>; var across: f32; switch corner { case 0u: { point = a - na * half; across = -half; } case 1u: { point = a + na * half; across = half; } case 2u: { point = b - nb * half; across = -half; } case 3u: { point = b - nb * half; across = -half; } case 4u: { point = a + na * half; across = half; } default: { point = b + nb * half; across = half; } } var out: VertexOutput; out.pos = vec4<f32>(toNdc(point - uniforms.offset, uniforms.resolution), 0.0, 1.0); out.color = instance.color; out.across = across; out.half_width = instance.stroke_width * 0.5; return out; } fn fragmentColor(in: VertexOutput) -> vec4<f32> { let d = max(uniforms.dpi, 0.001); let coverage = clamp((in.half_width - abs(in.across)) * d + 0.5, 0.0, 1.0); return vec4<f32>(in.color.rgb, in.color.a * coverage); } ${fragmentTail(blend)} `;
};

/**
 * The gradient ramp bound at group 1, shared by the marks that fill from one.
 * The stops are baked into a 1D texture on the CPU, so a gradient costs a
 * sample rather than a stop loop per fragment.
 */
const GRADIENT_BLOCK = ` struct GradientParams { coords: vec4<f32>, bounds: vec4<f32>, misc: vec4<f32>, } @group(1) @binding(0) var stopSampler: sampler; @group(1) @binding(1) var stopRamp: texture_2d<f32>; @group(1) @binding(2) var<uniform> gradient: GradientParams; fn gradientT(p: vec2<f32>, wh: vec2<f32>) -> f32 { if gradient.misc.x < 1.5 { let a = gradient.coords.xy; let b = gradient.coords.zw; let ab = b - a; let len2 = max(dot(ab, ab), 1e-6); return clamp(dot(p - a, ab) / len2, 0.0, 1.0); } let m = max(wh.x, wh.y); let c = gradient.coords.zw * wh; let r1 = gradient.misc.y * m; let r2 = gradient.misc.z * m; return clamp((distance(p * wh, c) - r1) / max(r2 - r1, 1e-6), 0.0, 1.0); }`;

/**
 * Triangulated geometry filled from a gradient ramp. The vertex colour carries
 * only the computed fill opacity, the ramp supplies the rest.
 */
const gradientFillShader = (blend) => ` ${uniformBlock()} ${GRADIENT_BLOCK} ${TO_NDC} struct VertexInput { @location(0) position: vec3<f32>, @location(1) fill_color: vec4<f32>, } struct VertexOutput { @builtin(position) pos: vec4<f32>, @location(0) world: vec2<f32>, @location(1) fill: vec4<f32>, } @vertex fn main_vertex(model: VertexInput) -> VertexOutput { let ndc = toNdc(model.position.xy - uniforms.offset, uniforms.resolution); var output: VertexOutput; output.pos = vec4<f32>(ndc, model.position.z + 0.5, 1.0); output.world = model.position.xy; output.fill = model.fill_color; return output; } fn fragmentColor(in: VertexOutput) -> vec4<f32> { let normalized = (in.world - gradient.bounds.xy) / max(gradient.bounds.zw, vec2<f32>(1e-6, 1e-6)); let t = gradientT(normalized, gradient.bounds.zw); let sample = textureSample(stopRamp, stopSampler, vec2<f32>(t, 0.5)); return vec4<f32>(sample.rgb, sample.a * in.fill.a); } ${fragmentTail(blend)} `;

/** One instanced quad per image, sampling the decoded bitmap. */
const imageShader = (blend) => ` ${uniformBlock()} @group(1) @binding(0) var imageSampler: sampler; @group(1) @binding(1) var imageTexture: texture_2d<f32>; ${TO_NDC} struct VertexInput { @location(0) position: vec2<f32>, } struct InstanceInput { @location(1) origin: vec2<f32>, @location(2) size: vec2<f32>, @location(3) opacity: f32, } struct VertexOutput { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32>, @location(1) opacity: f32, } @vertex fn main_vertex(model: VertexInput, instance: InstanceInput) -> VertexOutput { let p = model.position * instance.size + instance.origin - uniforms.offset; var output: VertexOutput; output.pos = vec4<f32>(toNdc(p, uniforms.resolution), 0.0, 1.0); output.uv = model.position; output.opacity = instance.opacity; return output; } fn fragmentColor(in: VertexOutput) -> vec4<f32> { let color = textureSample(imageTexture, imageSampler, in.uv); let rgb = color.rgb / max(color.a, 1e-6); return vec4<f32>(rgb, color.a * in.opacity); } ${fragmentTail(blend)} `;

/**
 * Rects and group backgrounds: one instanced quad each, with coverage computed
 * analytically so two abutting rects leave the faint seam canvas leaves rather
 * than a whole missing MSAA sample. Also carries the gradient-filled variant,
 * which shares the geometry and differs only in where the fill comes from.
 */
const rectShader = (blend) => ` ${uniformBlock('dpi')} ${GRADIENT_BLOCK} ${TO_NDC} ${FILL_STROKE_SHARE} ${BOX_COVERAGE} struct VertexInput { @location(0) position: vec2<f32>, } struct InstanceInput { @location(1) center: vec2<f32>, @location(2) scale: vec2<f32>, @location(3) fill_color: vec4<f32>, @location(4) stroke_color: vec4<f32>, @location(5) strokewidth: f32, @location(6) corner_radii: vec4<f32>, } struct VertexOutput { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32>, @location(1) fill: vec4<f32>, @location(2) stroke: vec4<f32>, @location(3) strokewidth: f32, @location(4) corner_radii: vec4<f32>, @location(5) scale: vec2<f32>, @location(6) lo_dev: vec2<f32>, @location(7) hi_dev: vec2<f32>, } @vertex fn main_vertex(model: VertexInput, instance: InstanceInput) -> VertexOutput { let d = max(uniforms.dpi, 0.001); let sw = vec2<f32>(instance.strokewidth, instance.strokewidth); let size = instance.scale + sw; let lo = instance.center - uniforms.offset - sw / 2.0; let hi = lo + size; let pad = vec2<f32>(1.0, 1.0) / d; let p = mix(lo - pad, hi + pad, model.position); var output: VertexOutput; output.pos = vec4<f32>(toNdc(p, uniforms.resolution), 0.0, 1.0); let uv = (p - lo) / max(size, vec2<f32>(1e-6, 1e-6)); output.uv = vec2<f32>(uv.x, 1.0 - uv.y); output.fill = instance.fill_color; output.stroke = instance.stroke_color; output.strokewidth = instance.strokewidth; output.corner_radii = instance.corner_radii; output.scale = instance.scale; output.lo_dev = lo * d; output.hi_dev = hi * d; return output; } fn sdRoundedRect(p: vec2<f32>, b: vec2<f32>, radii: vec4<f32>) -> f32 { var r = select( select(radii.z, radii.w, p.y > 0.0), select(radii.y, radii.x, p.y > 0.0), p.x > 0.0, ); r = min(r, min(b.x, b.y)); let q = abs(p) - b + vec2<f32>(r, r); return length(max(q, vec2<f32>(0.0, 0.0))) + min(max(q.x, q.y), 0.0) - r; } fn roundedRectColor(in: VertexOutput, fill: vec4<f32>) -> vec4<f32> { let p = (in.uv - vec2<f32>(0.5, 0.5)) * (in.scale + vec2<f32>(in.strokewidth, in.strokewidth)); let scale = max(uniforms.dpi, 0.001); let d = sdRoundedRect(p, in.scale * 0.5, in.corner_radii) * scale; let half_sw = in.strokewidth * 0.5 * scale; let aa = 0.75; let outer = 1.0 - smoothstep(half_sw - aa, half_sw + aa, d); let inner = 1.0 - smoothstep(-half_sw - aa, -half_sw + aa, d); return fillStrokeShare(fill, in.stroke, inner, outer); } fn straightRectColor(in: VertexOutput, fill: vec4<f32>) -> vec4<f32> { let p = in.pos.xy; let sw = vec2<f32>(in.strokewidth, in.strokewidth) * max(uniforms.dpi, 0.001); let outer = boxCoverage(p, in.lo_dev, in.hi_dev); let inner = boxCoverage(p, in.lo_dev + sw, in.hi_dev - sw); return fillStrokeShare(fill, in.stroke, inner, outer); } fn maxRadius(radii: vec4<f32>) -> f32 { return max(max(radii.x, radii.y), max(radii.z, radii.w)); } fn rectColor(in: VertexOutput, fill: vec4<f32>) -> vec4<f32> { if maxRadius(in.corner_radii) <= 0.0 { return straightRectColor(in, fill); } return roundedRectColor(in, fill); } fn fragmentColor(in: VertexOutput) -> vec4<f32> { return rectColor(in, in.fill); } fn gradientColor(in: VertexOutput) -> vec4<f32> { let p = vec2<f32>(in.uv.x, 1.0 - in.uv.y); let t = gradientT(p, in.scale); let sample = textureSample(stopRamp, stopSampler, vec2<f32>(t, 0.5)); return rectColor(in, vec4<f32>(sample.rgb, sample.a * in.fill.a)); } ${fragmentTail(blend, { main_fragment: 'fragmentColor', main_fragment_gradient: 'gradientColor' })} `;

/**
 * Axis-aligned rules, drawn as one instanced quad with analytic coverage. MSAA
 * quantizes a 1px rule to whole samples, so it reads as one hard column instead
 * of the soft two canvas draws.
 */
const ruleShader = (blend) => ` ${uniformBlock('dpi')} ${TO_NDC} ${BOX_COVERAGE} struct VertexInput { @location(0) position: vec2<f32>, @location(1) center: vec2<f32>, @location(2) scale: vec2<f32>, @location(3) stroke_color: vec4<f32>, @location(4) axis_offset: vec2<f32>, } struct VertexOutput { @builtin(position) pos: vec4<f32>, @location(1) stroke: vec4<f32>, @location(2) lo_dev: vec2<f32>, @location(3) hi_dev: vec2<f32>, } @vertex fn main_vertex(in: VertexInput) -> VertexOutput { let d = max(uniforms.dpi, 0.001); let lo = in.center - uniforms.offset - in.axis_offset; let hi = lo + in.scale; let pad = vec2<f32>(1.0, 1.0) / d; let p = mix(lo - pad, hi + pad, in.position); var output: VertexOutput; output.pos = vec4<f32>(toNdc(p, uniforms.resolution), 0.0, 1.0); output.stroke = in.stroke_color; output.lo_dev = lo * d; output.hi_dev = hi * d; return output; } fn fragmentColor(in: VertexOutput) -> vec4<f32> { return vec4<f32>(in.stroke.rgb, in.stroke.a * boxCoverage(in.pos.xy, in.lo_dev, in.hi_dev)); } ${fragmentTail(blend)} `;

/**
 * One quad per line segment instance, with the coverage of the segment computed
 * analytically. `caps` rounds an end, which is both a round stroke cap and the
 * round join at an interior vertex of a polyline. Dashes, dashed rect borders,
 * diagonal rules and line segments all come through here.
 */
const slineShader = (blend) => ` ${uniformBlock('dpi')} ${TO_NDC} ${SEGMENT_NORMAL} struct VertexInput { @location(0) start: vec2<f32>, @location(1) end: vec2<f32>, @location(2) color: vec4<f32>, @location(3) stroke_width: f32, @location(4) caps: vec2<f32>, } struct VertexOutput { @builtin(position) pos: vec4<f32>, @location(0) fill: vec4<f32>, @location(1) a_dev: vec2<f32>, @location(2) b_dev: vec2<f32>, @location(3) half_dev: f32, @location(4) caps: vec2<f32>, } @vertex fn main_vertex(in: VertexInput, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput { let d = max(uniforms.dpi, 0.001); let delta = in.end - in.start; let direction = safeDirection(delta); let normal = normalAt(delta); let pad = 1.0 / d; let half = in.stroke_width * 0.5; let side = normal * (half + pad); let behind = direction * (pad + select(0.0, half, in.caps.x > 0.5)); let ahead = direction * (pad + select(0.0, half, in.caps.y > 0.5)); let p1 = in.start - side - behind; let p2 = in.start + side - behind; let p3 = in.end - side + ahead; let p4 = in.end + side + ahead; var vertices = array(p1, p2, p3, p4, p2, p3); let ndc = toNdc(vertices[vertexIndex] - uniforms.offset, uniforms.resolution); var out: VertexOutput; out.pos = vec4<f32>(ndc, 0.0, 1.0); out.fill = in.color; out.a_dev = (in.start - uniforms.offset) * d; out.b_dev = (in.end - uniforms.offset) * d; out.half_dev = half * d; out.caps = in.caps; return out; } fn fragmentColor(in: VertexOutput) -> vec4<f32> { let ab = in.b_dev - in.a_dev; let len = length(ab); let e = safeDirection(ab); let v = in.pos.xy - in.a_dev; let along = dot(v, e); let dist = length(v - e * clamp(along, 0.0, len)); let cover = clamp(in.half_dev - dist + 0.5, 0.0, 1.0) - clamp(-in.half_dev - dist + 0.5, 0.0, 1.0); let behind = select(clamp(along + 0.5, 0.0, 1.0), 1.0, in.caps.x > 0.5); let ahead = select(clamp(len - along + 0.5, 0.0, 1.0), 1.0, in.caps.y > 0.5); return vec4<f32>(in.fill.rgb, in.fill.a * cover * behind * ahead); } ${fragmentTail(blend)} `;

/**
 * Triangulated geometry with a colour per vertex, which is what the area, path
 * and shape marks all reduce to once their contours are tessellated.
 */
const solidFillShader = (blend) => ` ${uniformBlock()} ${TO_NDC} struct VertexInput { @location(0) position: vec3<f32>, @location(1) fill_color: vec4<f32>, } struct VertexOutput { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32>, @location(1) fill: vec4<f32>, } @vertex fn main_vertex(model: VertexInput) -> VertexOutput { let ndc = toNdc(model.position.xy - uniforms.offset, uniforms.resolution); var output: VertexOutput; output.pos = vec4<f32>(ndc, model.position.z + 0.5, 1.0); output.uv = ndc; output.fill = model.fill_color; return output; } fn fragmentColor(in: VertexOutput) -> vec4<f32> { return in.fill; } ${fragmentTail(blend)} `;

/** Analytic circles: one instanced quad per symbol, edge and stroke by distance. */
const symbolShader = (blend) => ` ${uniformBlock('dpi')} ${TO_NDC} ${FILL_STROKE_SHARE} struct VertexInput { @location(0) position: vec2<f32>, } struct InstanceInput { @location(1) center: vec2<f32>, @location(2) radius: f32, @location(3) fill_color: vec4<f32>, @location(4) stroke_color: vec4<f32>, @location(5) stroke_width: f32, } struct VertexOutput { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32>, @location(1) fill: vec4<f32>, @location(2) stroke_color: vec4<f32>, @location(3) radius: f32, @location(4) stroke_width: f32, @location(5) geom_radius: f32, } const pad = 1.0; @vertex fn main_vertex(model: VertexInput, instance: InstanceInput) -> VertexOutput { let geom_radius = instance.radius + instance.stroke_width * 0.5 + pad; let p = model.position * geom_radius + instance.center - uniforms.offset; var output: VertexOutput; output.pos = vec4<f32>(toNdc(p, uniforms.resolution), 0.0, 1.0); output.uv = model.position * 0.5 + vec2<f32>(0.5, 0.5); output.fill = instance.fill_color; output.stroke_color = instance.stroke_color; output.radius = instance.radius; output.stroke_width = instance.stroke_width; output.geom_radius = geom_radius; return output; } fn fragmentColor(in: VertexOutput) -> vec4<f32> { let d = distance(in.uv, vec2<f32>(0.5, 0.5)) * 2.0 * in.geom_radius; let scale = max(uniforms.dpi, 0.001); let half_sw = in.stroke_width * 0.5; let outer = clamp(0.5 - (d - in.radius - half_sw) * scale, 0.0, 1.0); let inner = clamp(0.5 - (d - in.radius + half_sw) * scale, 0.0, 1.0); return fillStrokeShare(in.fill, in.stroke_color, inner, outer); } ${fragmentTail(blend)} `;

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
    return ` ${uniformBlock('dpi')} ${TO_NDC} ${FILL_STROKE_SHARE} struct VertexInput { @location(0) position: vec2<f32>, } struct InstanceInput { @location(1) center: vec2<f32>, @location(2) size: f32, @location(3) fill_color: vec4<f32>, @location(4) stroke_color: vec4<f32>, @location(5) stroke_width: f32, @location(6) angle: f32, } struct VertexOutput { @builtin(position) pos: vec4<f32>, @location(0) local: vec2<f32>, @location(1) fill: vec4<f32>, @location(2) stroke: vec4<f32>, @location(3) size: f32, @location(4) stroke_width: f32, } fn sdTriangle(p: vec2<f32>, p0: vec2<f32>, p1: vec2<f32>, p2: vec2<f32>) -> f32 { let e0 = p1 - p0; let e1 = p2 - p1; let e2 = p0 - p2; let v0 = p - p0; let v1 = p - p1; let v2 = p - p2; let pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0); let pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0); let pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0); let s = sign(e0.x * e2.y - e0.y * e2.x); let d = min( min( vec2<f32>(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)), vec2<f32>(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x)), ), vec2<f32>(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)), ); return -sqrt(d.x) * sign(d.y); } fn sdBox(p: vec2<f32>, b: vec2<f32>) -> f32 { let d = abs(p) - b; return length(max(d, vec2<f32>(0.0, 0.0))) + min(max(d.x, d.y), 0.0); } fn sdTriangleInflated(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>, c: vec2<f32>, inflate: f32) -> f32 { let la = distance(b, c); let lb = distance(a, c); let lc = distance(a, b); let perimeter = la + lb + lc; let incentre = (la * a + lb * b + lc * c) / perimeter; let area = abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) * 0.5; let inradius = area / max(perimeter * 0.5, 1e-6); let k = 1.0 + inflate / max(inradius, 1e-6); return sdTriangle(p, incentre + (a - incentre) * k, incentre + (b - incentre) * k, incentre + (c - incentre) * k); } fn shapeDistance(p: vec2<f32>, s: f32, inflate: f32) -> f32 { ${spec.sdf} } fn shapeExtent(s: f32, half_width: f32) -> f32 { return ${spec.reach} * s + ${spec.miter} * half_width + 1.0; } @vertex fn main_vertex(model: VertexInput, instance: InstanceInput) -> VertexOutput { let extent = shapeExtent(instance.size, instance.stroke_width * 0.5); let local = model.position * extent; let c = cos(instance.angle); let sn = sin(instance.angle); let rotated = vec2<f32>(local.x * c - local.y * sn, local.x * sn + local.y * c); var output: VertexOutput; output.pos = vec4<f32>(toNdc(rotated + instance.center - uniforms.offset, uniforms.resolution), 0.0, 1.0); output.local = local; output.fill = instance.fill_color; output.stroke = instance.stroke_color; output.size = instance.size; output.stroke_width = instance.stroke_width; return output; } fn fragmentColor(in: VertexOutput) -> vec4<f32> { let d = max(uniforms.dpi, 0.001); let half_sw = in.stroke_width * 0.5; let outer = clamp(0.5 - shapeDistance(in.local, in.size, half_sw) * d, 0.0, 1.0); let inner = clamp(0.5 - shapeDistance(in.local, in.size, -half_sw) * d, 0.0, 1.0); return fillStrokeShare(in.fill, in.stroke, inner, outer); } ${fragmentTail(blend)} `;
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
const textShader = (blend) => ` ${uniformBlock()} @group(1) @binding(0) var texSampler: sampler; @group(1) @binding(1) var tex: texture_2d<f32>; ${TO_NDC} struct VertexInput { @location(0) rect: vec4<f32>, @location(1) uv: vec4<f32>, @location(2) turn: vec4<f32>, @location(3) opacity: f32, } struct VertexOutput { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32>, @location(1) opacity: f32, } @vertex fn main_vertex(in: VertexInput, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput { var corners = array( vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 1.0), ); let c = corners[vertexIndex]; var p = mix(in.rect.xy, in.rect.zw, c); if (in.turn.w != 0.0 || in.turn.z != 1.0) { let d = p - in.turn.xy; p = in.turn.xy + vec2<f32>(d.x * in.turn.z - d.y * in.turn.w, d.x * in.turn.w + d.y * in.turn.z); } var output: VertexOutput; output.pos = vec4<f32>(toNdc(p - uniforms.offset, uniforms.resolution), 0.0, 1.0); output.uv = mix(in.uv.xy, in.uv.zw, c); output.opacity = in.opacity; return output; } fn fragmentColor(in: VertexOutput) -> vec4<f32> { let c = textureSample(tex, texSampler, in.uv); let rgb = c.rgb / max(c.a, 1e-6); return vec4<f32>(rgb, c.a * in.opacity); } ${fragmentTail(blend)} `;

/** Every shader source, by the name marks ask for. */
const BUILDERS = {
    Curve: curveShader,
    GradientFill: gradientFillShader,
    Image: imageShader,
    Rect: rectShader,
    Rule: ruleShader,
    SLine: slineShader,
    SolidFill: solidFillShader,
    Symbol: symbolShader,
    SymbolSdf: symbolSdfShader,
    SymbolShape: symbolShapeShader,
    Text: textShader,
};
/** Shader key for one analytic symbol shape. */
function symbolSdfKey(shape) {
    return `SymbolSdf:${shape}`;
}
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

/** Texels in a baked gradient stop ramp. */
const RAMP_SIZE = 256;
function getGradientResources(device, ctx) {
    return getMarkResources(ctx, '__gradient', device, undefined, () => ({
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
        buffers?.setOffset([vb.x1, vb.y1]);
        buffers?.setDpi(ctx._uniforms.dpi);
    }
    return res;
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
/** Draws geometry whose color comes from a ramp rather than its vertices. */
function enqueueGradient(target, data, gradient, bounds, blend = 'normal') {
    const { ctx, device } = target;
    const pipeline = target.pipelineFor(blend);
    ctx._renderQueue.enqueue({
        pipeline,
        drawCounts: [data.length / target.vertexLength],
        vertexBuffers: [target.bufferManager.createGeometryBuffer(data)],
        bindGroups: [
            createUniformBindGroup(target.name, device, pipeline, target.uniformBuffer),
            createGradientBindGroup(getGradientResources(device, ctx), pipeline, gradient, gradientBounds(ctx, bounds)),
        ],
        clip: target.clip,
    });
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
/**
 * Rect and group strokes are drawn analytically in the fragment shader, which
 * cannot express a dash pattern. When `strokeDash` is set the border is walked
 * as a closed polyline instead and emitted as single-segment line instances.
 * Returns null when the item has no dashed border to draw.
 */
/**
 * Builds a mark pipeline. The colour format and sample count must match the
 * frame's attachments, and getting either wrong silently breaks MSAA, so they
 * are filled in here rather than repeated at every call site.
 */
function markPipeline(ctx, device, label, shaderKey, vertexManager, fragmentEntryPoint, blend = 'normal') {
    const buffers = vertexManager.getBuffers();
    const key = `${shaderKey}|${fragmentEntryPoint ?? ''}|${ctx._sampleCount}|${blend}|${JSON.stringify(buffers)}`;
    const cached = ctx._pipelineCache[key];
    if (cached) {
        return cached;
    }
    const pipeline = createRenderPipeline(label, device, shaderModule(ctx, device, shaderKey, blend), preferredColorFormat(), ctx._sampleCount, buffers, undefined, fragmentEntryPoint, blendState(blend));
    ctx._pipelineCache[key] = pipeline;
    return pipeline;
}
/**
 * Vertex layout of a single line segment instance, shared by every mark that
 * draws through the SLine shader: line segments, dashes, dashed borders and
 * diagonal rules. `caps` rounds an end, which covers both a round stroke cap
 * and the round join at an interior vertex.
 */
const SEGMENT_LAYOUT = ['float32x2', 'float32x2', 'float32x4', 'float32', 'float32x2'];
/** Floats per segment instance: start, end, colour, width, caps. */
const SEGMENT_STRIDE = 11;
/** Packs one segment as start, end, colour, width, caps. */
function segmentInstance(x1, y1, x2, y2, color, width, caps = BUTT) {
    return Float32Array.from([x1, y1, x2, y2, ...color, width, caps[0], caps[1]]);
}
const BUTT = [0, 0];
/** Packs every segment of every polyline, or null when there is nothing to draw. */
function segmentInstances(runs, color, width, caps = BUTT) {
    const count = segmentCount(runs);
    if (count === 0) {
        return null;
    }
    const data = new Float32Array(count * SEGMENT_STRIDE);
    writeSegments(data, 0, runs, color, width, caps);
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
/**
 * Writes runs as segment instances into `data` at `offset`, returning where it
 * stopped. Field by field rather than through a temporary array, since a
 * choropleth's borders run to hundreds of thousands of segments a frame.
 *
 * `caps` applies to a run's two outer ends. Every interior vertex is rounded
 * regardless, since two butt ends meeting at an angle leave the outside of the
 * corner unpainted.
 */
function writeSegments(data, offset, runs, color, width, caps = BUTT) {
    const [r, g, b, a] = color;
    let i = offset;
    for (const run of runs) {
        const last = run.length - 2;
        for (let s = 0; s < run.length - 1; s++) {
            const p = run[s];
            const q = run[s + 1];
            data[i] = p[0];
            data[i + 1] = p[1];
            data[i + 2] = q[0];
            data[i + 3] = q[1];
            data[i + 4] = r;
            data[i + 5] = g;
            data[i + 6] = b;
            data[i + 7] = a;
            data[i + 8] = width;
            data[i + 9] = s === 0 ? caps[0] : 0;
            data[i + 10] = s === last ? caps[1] : 1;
            i += SEGMENT_STRIDE;
        }
    }
    return i;
}
/**
 * Rect and group strokes are drawn analytically in the fragment shader, which
 * cannot express a dash pattern. When `strokeDash` is set the border is walked
 * as a closed polyline instead and emitted as single-segment line instances.
 * Returns null when the item has no dashed border to draw.
 */
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
function dashedBorderInstances(item) {
    const pattern = Array.isArray(item.strokeDash) ? item.strokeDash : undefined;
    if (!pattern?.length || !item.stroke) {
        return null;
    }
    const x = item.x || 0;
    const y = item.y || 0;
    const w = item.width || 0;
    const h = item.height || 0;
    if (w <= 0 || h <= 0) {
        return null;
    }
    const border = [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
        [x, y],
    ];
    const runs = dashPolyline(border, pattern, item.strokeDashOffset ?? 0);
    const color = Color.from2(item.stroke, item.opacity, item.strokeOpacity);
    return segmentInstances(runs, color, item.strokeWidth ?? 1);
}
// Bounds the cache so a streaming session, where every frame brings new datum
// ids, cannot grow it without limit.
const MAX_GEOMETRY_CACHE = 4096;
/** Identifies an item across frames: vega keeps tuple ids on a symbol. */
function cacheKey$1(item) {
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
function copyBounds$1(b) {
    return b ? { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 } : undefined;
}
function sameBounds$1(b, snap) {
    if (!b || !snap) {
        return b === undefined && snap === undefined;
    }
    return b.x1 === snap.x1 && b.y1 === snap.y1 && b.x2 === snap.x2 && b.y2 === snap.y2;
}
function sameColor$1(a, b) {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}
/** Copies positions from `source` and writes `color` into every vertex. */
function recolor$1(data, source, color) {
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
/**
 * Returns the item's vertex data, building it only when the geometry changed.
 * A colour-only change rewrites the colours over the cached positions instead
 * of triangulating again.
 */
function cachedGeometryData(cache, item, fill, stroke, build) {
    const key = cacheKey$1(item);
    const entry = cache.get(key);
    if (entry &&
        item.strokeWidth === entry.strokeWidth &&
        item.x === entry.x &&
        item.y === entry.y &&
        item.path === entry.path &&
        item.angle === entry.angle &&
        item.scaleX === entry.scaleX &&
        item.scaleY === entry.scaleY &&
        sameBounds$1(item.bounds, entry.bounds)) {
        // re-insert to keep the map in least-recently-used order
        cache.delete(key);
        cache.set(key, entry);
        if (sameColor$1(entry.fill, fill) && sameColor$1(entry.stroke, stroke)) {
            return entry.data;
        }
        const data = [
            new Float32Array(entry.data[0].length),
            new Float32Array(entry.data[1].length),
        ];
        recolor$1(data[0], entry.data[0], fill);
        recolor$1(data[1], entry.data[1], stroke);
        return data;
    }
    const data = build();
    if (cache.size >= MAX_GEOMETRY_CACHE) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) {
            cache.delete(oldest);
        }
    }
    cache.set(key, {
        fill,
        stroke,
        x: item.x,
        y: item.y,
        bounds: copyBounds$1(item.bounds),
        strokeWidth: item.strokeWidth,
        path: item.path,
        angle: item.angle,
        scaleX: item.scaleX,
        scaleY: item.scaleY,
        data,
    });
    return data;
}

const drawName$b = 'Arc';
function getResources$b(device, ctx, vb) {
    return getMarkResources(ctx, 'arc', device, vb, () => {
        const bufferManager = new BufferManager(device, drawName$b, ctx._uniforms.resolution, [vb.x1, vb.y1]);
        const vertexManager = new VertexBufferManager(['float32x3', 'float32x4'], // position, color
        []);
        const pipeline = markPipeline(ctx, device, drawName$b, 'SolidFill', vertexManager);
        // blend needs its own pipeline, and markPipeline caches them by mode
        const pipelineFor = (blend) => blend === 'normal'
            ? pipeline
            : markPipeline(ctx, device, `${drawName$b} ${blend}`, 'SolidFill', vertexManager, undefined, blend);
        const gradientPipeline = markPipeline(ctx, device, `${drawName$b}Gradient`, 'GradientFill', vertexManager);
        // a gradient fill under a blend needs its own pipeline too
        const gradientPipelineFor = (blend) => blend === 'normal'
            ? gradientPipeline
            : markPipeline(ctx, device, `${drawName$b}Gradient ${blend}`, 'GradientFill', vertexManager, undefined, blend);
        return { device, bufferManager, vertexManager, pipeline, pipelineFor, gradientPipelineFor };
    });
}
function draw$b(device, ctx, scene, vb) {
    const items = scene.items;
    if (!items?.length) {
        return;
    }
    const res = getResources$b(device, ctx, vb);
    const uniformBuffer = res.bufferManager.createUniformBuffer();
    const clip = markClip(ctx, scene);
    const vertexLength = res.vertexManager.getVertexLength();
    const gradientTarget = {
        ctx,
        device,
        name: `${drawName$b}Gradient`,
        pipelineFor: res.gradientPipelineFor,
        bufferManager: res.bufferManager,
        uniformBuffer,
        vertexLength,
        clip,
    };
    // Solid fills and strokes share one pipeline and are accumulated in paint
    // order into a single buffer/draw. Gradient fills interrupt the batch.
    const batch = new GeometryBatch();
    // one batch draws with one pipeline, so a change of blend closes it
    let batchBlend = 'normal';
    const flushBatch = () => {
        const data = batch.flush();
        if (data) {
            const pipeline = res.pipelineFor(batchBlend);
            ctx._renderQueue.enqueue({
                pipeline,
                drawCounts: [data.length / vertexLength],
                vertexBuffers: [res.bufferManager.createGeometryBuffer(data)],
                bindGroups: [createUniformBindGroup(drawName$b, device, pipeline, uniformBuffer)],
                clip,
            });
        }
    };
    for (const item of items) {
        const blend = blendKey(item.blend);
        if (blend !== batchBlend) {
            flushBatch();
            batchBlend = blend;
        }
        const bounds = item.bounds;
        const gradient = isGradient(item.fill) && bounds ? item.fill : null;
        const fill = gradient
            ? whiteCarrier(item.opacity, item.fillOpacity)
            : Color.from2(item.fill, item.opacity, item.fillOpacity);
        const strokeGradient = isGradient(item.stroke) && bounds ? item.stroke : null;
        const stroke = strokeGradient
            ? whiteCarrier(item.opacity, item.strokeOpacity)
            : Color.from2(item.stroke, item.opacity, item.strokeOpacity);
        const shapeGeom = arc$1(ctx, item);
        // arc paths are generated around the origin, so bake the item center in
        const geometry = geometryForItem(ctx, item, shapeGeom, false, item.x || 0, item.y || 0);
        const [fillData, strokeData] = geometryVertexData(geometry, fill, stroke);
        if (fillData.length > 0 && gradient && bounds) {
            flushBatch();
            enqueueGradient(gradientTarget, fillData, gradient, bounds, blendKey(item.blend));
        }
        else {
            batch.push(fillData);
        }
        if (strokeData.length > 0 && strokeGradient && bounds) {
            flushBatch();
            enqueueGradient(gradientTarget, strokeData, strokeGradient, bounds, blendKey(item.blend));
        }
        else {
            batch.push(strokeData);
        }
    }
    flushBatch();
}
var arc = {
    type: 'arc',
    draw: draw$b,
};

const drawName$a = 'Area';
function getResources$a(device, ctx, vb) {
    return getMarkResources(ctx, 'area', device, vb, () => {
        const bufferManager = new BufferManager(device, drawName$a, ctx._uniforms.resolution, [vb.x1, vb.y1]);
        const vertexManager = new VertexBufferManager(['float32x3', 'float32x4'], // position, color
        []);
        const pipeline = markPipeline(ctx, device, drawName$a, 'SolidFill', vertexManager);
        // blend needs its own pipeline, and markPipeline caches them by mode
        const pipelineFor = (blend) => blend === 'normal'
            ? pipeline
            : markPipeline(ctx, device, `${drawName$a} ${blend}`, 'SolidFill', vertexManager, undefined, blend);
        const gradientPipeline = markPipeline(ctx, device, `${drawName$a}Gradient`, 'GradientFill', vertexManager);
        // a gradient fill under a blend needs its own pipeline too
        const gradientPipelineFor = (blend) => blend === 'normal'
            ? gradientPipeline
            : markPipeline(ctx, device, `${drawName$a}Gradient ${blend}`, 'GradientFill', vertexManager, undefined, blend);
        return { device, bufferManager, vertexManager, pipeline, pipelineFor, gradientPipelineFor };
    });
}
function draw$a(device, ctx, scene, vb) {
    const items = scene.items;
    if (!items?.length) {
        return;
    }
    const res = getResources$a(device, ctx, vb);
    // An area mark renders all its items as one shape.
    const item = items[0];
    const pipeline = res.pipelineFor(blendKey(item.blend));
    const bounds = scene.bounds ?? item.bounds;
    const gradient = isGradient(item.fill) && bounds ? item.fill : null;
    const fill = gradient
        ? whiteCarrier(item.opacity, item.fillOpacity)
        : Color.from2(item.fill, item.opacity, item.fillOpacity);
    const strokeGradient = isGradient(item.stroke) && bounds ? item.stroke : null;
    const stroke = strokeGradient
        ? whiteCarrier(item.opacity, item.strokeOpacity)
        : Color.from2(item.stroke, item.opacity, item.strokeOpacity);
    const shapeGeom = area$1(ctx, items);
    const geometry = geometryForItem(ctx, item, shapeGeom, true);
    const [fillData, strokeData] = geometryVertexData(geometry, fill, stroke);
    const uniformBuffer = res.bufferManager.createUniformBuffer();
    const clip = markClip(ctx, scene);
    const vertexLength = res.vertexManager.getVertexLength();
    const gradientTarget = {
        ctx,
        device,
        name: `${drawName$a}Gradient`,
        pipelineFor: res.gradientPipelineFor,
        bufferManager: res.bufferManager,
        uniformBuffer,
        vertexLength,
        clip,
    };
    if (fillData.length > 0) {
        if (gradient && bounds) {
            enqueueGradient(gradientTarget, fillData, gradient, bounds, blendKey(item.blend));
        }
        else {
            ctx._renderQueue.enqueue({
                pipeline,
                drawCounts: [fillData.length / vertexLength],
                vertexBuffers: [res.bufferManager.createGeometryBuffer(fillData)],
                bindGroups: [createUniformBindGroup(drawName$a, device, pipeline, uniformBuffer)],
                clip,
            });
        }
    }
    if (strokeData.length > 0) {
        if (strokeGradient && bounds) {
            enqueueGradient(gradientTarget, strokeData, strokeGradient, bounds, blendKey(item.blend));
        }
        else {
            ctx._renderQueue.enqueue({
                pipeline,
                drawCounts: [strokeData.length / vertexLength],
                vertexBuffers: [res.bufferManager.createGeometryBuffer(strokeData)],
                bindGroups: [createUniformBindGroup(drawName$a, device, pipeline, uniformBuffer)],
                clip,
            });
        }
    }
}
var area = {
    type: 'area',
    draw: draw$a,
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

const drawName$9 = 'Rect';
function getResources$9(device, ctx, vb) {
    return getMarkResources(ctx, 'rect', device, vb, () => {
        const bufferManager = new BufferManager(device, drawName$9, ctx._uniforms.resolution, [vb.x1, vb.y1]);
        const vertexManager = new VertexBufferManager(['float32x2'], // position
        // center, dimensions, fill color, stroke color, stroke width, corner radii
        ['float32x2', 'float32x2', 'float32x4', 'float32x4', 'float32', 'float32x4']);
        const pipeline = markPipeline(ctx, device, drawName$9, 'Rect', vertexManager);
        const gradientPipeline = markPipeline(ctx, device, `${drawName$9}Gradient`, 'Rect', vertexManager, 'main_fragment_gradient');
        // a gradient fill under a blend needs its own pipeline too
        const gradientPipelineFor = (blend) => blend === 'normal'
            ? gradientPipeline
            : markPipeline(ctx, device, `${drawName$9}Gradient ${blend}`, 'Rect', vertexManager, 'main_fragment_gradient', blend);
        const geometryBuffer = bufferManager.createGeometryBuffer(quadVertex, undefined, true);
        return {
            device,
            bufferManager,
            vertexManager,
            pipeline,
            gradientPipelineFor,
            geometryBuffer,
            blendPipelines: new Map(),
        };
    });
}
function draw$9(device, ctx, scene, vb) {
    const items = scene.items;
    if (!items?.length) {
        return;
    }
    const res = getResources$9(device, ctx, vb);
    const uniformBuffer = res.bufferManager.createUniformBuffer();
    const clip = markClip(ctx, scene);
    // only materialise the gradient sampler and ramp cache if a gradient shows up
    let gres = null;
    const gradientResources = () => (gres ??= getGradientResources(device, ctx));
    let run = [];
    let runBlend = 'normal';
    const pipelineFor = (blend) => {
        if (blend === 'normal') {
            return res.pipeline;
        }
        let pipeline = res.blendPipelines.get(blend);
        if (!pipeline) {
            pipeline = markPipeline(ctx, device, `${drawName$9} ${blend}`, 'Rect', res.vertexManager, undefined, blend);
            res.blendPipelines.set(blend, pipeline);
        }
        return pipeline;
    };
    const flushRun = () => {
        if (run.length === 0) {
            return;
        }
        const pipeline = pipelineFor(runBlend);
        const instanceBuffer = res.bufferManager.createInstanceBuffer(rectAttributes(run));
        ctx._renderQueue.enqueue({
            pipeline,
            drawCounts: [6, run.length],
            vertexBuffers: [res.geometryBuffer, instanceBuffer],
            bindGroups: [createUniformBindGroup(drawName$9, device, pipeline, uniformBuffer)],
            clip,
        });
        run = [];
    };
    for (const item of items) {
        const fill = item.fill;
        const blend = blendKey(item.blend);
        if (!isGradient(fill)) {
            // a run shares one pipeline, so a change of blend starts a new one
            if (blend !== runBlend && run.length > 0) {
                flushRun();
            }
            runBlend = blend;
            run.push(item);
            continue;
        }
        flushRun();
        runBlend = blend;
        const gradientPipeline = res.gradientPipelineFor(blend);
        const instanceBuffer = res.bufferManager.createInstanceBuffer(rectAttributes([item], true));
        ctx._renderQueue.enqueue({
            pipeline: gradientPipeline,
            drawCounts: [6, 1],
            vertexBuffers: [res.geometryBuffer, instanceBuffer],
            bindGroups: [
                createUniformBindGroup(`${drawName$9}Gradient`, device, gradientPipeline, uniformBuffer),
                // rect gradients evaluate in uv space, bounds are the unit square
                createGradientBindGroup(gradientResources(), gradientPipeline, fill, [0, 0, 1, 1]),
            ],
            clip,
        });
    }
    flushRun();
}
function rectAttributes(items, whiteGradientFill = false) {
    return Float32Array.from(items.flatMap(rect => {
        const { opacity = 1, fill, fillOpacity = 1, stroke, strokeOpacity = 1, strokeWidth, cornerRadius = 0, cornerRadiusBottomLeft, cornerRadiusBottomRight, cornerRadiusTopRight, cornerRadiusTopLeft, } = rect;
        const item = rect;
        const x = item.x || 0;
        const y = item.y || 0;
        const width = item.width || 0;
        const height = item.height || 0;
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
    draw: draw$9,
};

const drawName$8 = 'Group';
function getResources$8(device, ctx, vb) {
    return getMarkResources(ctx, 'group', device, vb, () => {
        const bufferManager = new BufferManager(device, drawName$8, ctx._uniforms.resolution, [vb.x1, vb.y1]);
        const vertexManager = new VertexBufferManager(['float32x2'], // position
        // center, dimensions, fill color, stroke color, stroke width, corner radii
        ['float32x2', 'float32x2', 'float32x4', 'float32x4', 'float32', 'float32x4']);
        const pipeline = markPipeline(ctx, device, drawName$8, 'Rect', vertexManager);
        const gradientPipeline = markPipeline(ctx, device, `${drawName$8}Gradient`, 'Rect', vertexManager, 'main_fragment_gradient');
        // a gradient fill under a blend needs its own pipeline too
        const gradientPipelineFor = (blend) => blend === 'normal'
            ? gradientPipeline
            : markPipeline(ctx, device, `${drawName$8}Gradient ${blend}`, 'Rect', vertexManager, 'main_fragment_gradient', blend);
        const dashVertexManager = new VertexBufferManager([], SEGMENT_LAYOUT);
        const dashPipeline = markPipeline(ctx, device, `${drawName$8}Dash`, 'SLine', dashVertexManager);
        const geometryBuffer = bufferManager.createGeometryBuffer(quadVertex, undefined, true);
        return { device, bufferManager, vertexManager, pipeline, gradientPipelineFor, dashPipeline, geometryBuffer };
    });
}
function draw$8(device, ctx, scene, vb, markTypes) {
    const items = scene.items;
    if (!items?.length) {
        return;
    }
    const res = getResources$8(device, ctx, vb);
    // Held borders draw after their children, by which point the visit has put
    // the clip back to what it was, so both passes take the same one.
    const parentClip = ctx._clip;
    const uniformBuffer = res.bufferManager.createUniformBuffer();
    const uniformBindGroup = createUniformBindGroup(drawName$8, device, res.pipeline, uniformBuffer);
    // Group backgrounds share the rect instance layout and shader.
    // only materialise the gradient sampler and ramp cache if a gradient shows up
    let gres = null;
    const gradientResources = () => (gres ??= getGradientResources(device, ctx));
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
    const dashed = [];
    // A group asking for strokeForeground has its border held back and enqueued
    // after its own children, which is where vega draws it.
    const held = new Map();
    for (const item of items) {
        const edged = withStrokeOffset(item);
        const border = dashedBorderInstances(edged);
        const fore = item.strokeForeground === true && item.stroke != null;
        if (fore) {
            held.set(item, { rect: { ...edged, fill: undefined }, dash: border });
        }
        else if (border) {
            dashed.push(border);
        }
        const drawn = border || fore ? { ...edged, stroke: undefined } : edged;
        const fill = drawn.fill;
        if (!isGradient(fill)) {
            run.push(drawn);
            continue;
        }
        flushRun();
        const gradientPipeline = res.gradientPipelineFor(blendKey(item.blend));
        const instanceBuffer = res.bufferManager.createInstanceBuffer(rectAttributes([drawn], true));
        ctx._renderQueue.enqueue({
            pipeline: gradientPipeline,
            drawCounts: [6, 1],
            vertexBuffers: [res.geometryBuffer, instanceBuffer],
            bindGroups: [
                createUniformBindGroup(`${drawName$8}Gradient`, device, gradientPipeline, uniformBuffer),
                createGradientBindGroup(gradientResources(), gradientPipeline, fill, [0, 0, 1, 1]),
            ],
            clip: ctx._clip,
        });
    }
    flushRun();
    for (const data of dashed) {
        ctx._renderQueue.enqueue({
            pipeline: res.dashPipeline,
            drawCounts: [6, data.length / SEGMENT_STRIDE],
            vertexBuffers: [res.bufferManager.createInstanceBuffer(data)],
            bindGroups: [createUniformBindGroup(`${drawName$8}Dash`, device, res.dashPipeline, uniformBuffer)],
            clip: ctx._clip,
        });
    }
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
        const fore = held.get(group);
        if (fore) {
            if (fore.dash) {
                ctx._renderQueue.enqueue({
                    pipeline: res.dashPipeline,
                    drawCounts: [6, fore.dash.length / SEGMENT_STRIDE],
                    vertexBuffers: [res.bufferManager.createInstanceBuffer(fore.dash)],
                    bindGroups: [createUniformBindGroup(`${drawName$8}Dash`, device, res.dashPipeline, uniformBuffer)],
                    clip: parentClip,
                });
            }
            else {
                ctx._renderQueue.enqueue({
                    pipeline: res.pipeline,
                    drawCounts: [6, 1],
                    vertexBuffers: [res.geometryBuffer, res.bufferManager.createInstanceBuffer(rectAttributes([fore.rect]))],
                    bindGroups: [uniformBindGroup],
                    clip: parentClip,
                });
            }
        }
    });
}
var group = {
    type: 'group',
    draw: draw$8,
};

const drawName$7 = 'Image';
function getResources$7(device, ctx, vb) {
    return getMarkResources(ctx, 'image', device, vb, () => {
        const bufferManager = new BufferManager(device, drawName$7, ctx._uniforms.resolution, [vb.x1, vb.y1]);
        const vertexManager = new VertexBufferManager(['float32x2'], // position
        ['float32x2', 'float32x2', 'float32']);
        const pipeline = markPipeline(ctx, device, drawName$7, drawName$7, vertexManager);
        const geometryBuffer = bufferManager.createGeometryBuffer(quadVertex, undefined, true);
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
    // Keep the texture premultiplied. Converting to straight alpha turns a fully
    // transparent texel into transparent black, and filtering then drags
    // neighbouring colour toward it: a red image with transparent white corners
    // lost its red near them. Canvas filters premultiplied, and the shader
    // divides the alpha back out after sampling.
    device.queue.copyExternalImageToTexture({ source }, { texture, premultipliedAlpha: true }, [width, height]);
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
function draw$7(device, ctx, scene, vb) {
    const items = scene.items;
    if (!items?.length) {
        return;
    }
    const res = getResources$7(device, ctx, vb);
    const uniformBuffer = res.bufferManager.createUniformBuffer();
    const uniformBindGroup = createUniformBindGroup(drawName$7, device, res.pipeline, uniformBuffer);
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
    draw: draw$7,
};

const drawName$6 = 'Line';
/**
 * The two cubics the GPU evaluates, each with the shader that reads its control
 * points and the packer that produces them.
 */
const CURVES = {
    basis: { shader: 'Curve:basis', instances: basisInstances },
    bezier: { shader: 'Curve:bezier', instances: bezierInstances },
};
function getResources$6(device, ctx, vb) {
    return getMarkResources(ctx, 'line', device, vb, () => {
        const bufferManager = new BufferManager(device, drawName$6, ctx._uniforms.resolution, [vb.x1, vb.y1]);
        const segmentVertexManager = new VertexBufferManager([], SEGMENT_LAYOUT);
        const segmentPipeline = markPipeline(ctx, device, drawName$6, 'SLine', segmentVertexManager);
        const curveVertexManager = new VertexBufferManager(['float32x3', 'float32x4']); // position, color
        const spanVertexManager = new VertexBufferManager([], 
        // p0, p1, p2, p3, color, stroke width, kind
        ['float32x2', 'float32x2', 'float32x2', 'float32x2', 'float32x4', 'float32', 'float32']);
        const curvePipeline = markPipeline(ctx, device, `${drawName$6}Curve`, 'SolidFill', curveVertexManager);
        return {
            curveVertexManager,
            curvePipeline,
            spanVertexManager,
            spanBindGroups: new Map(),
            device,
            bufferManager,
            segmentVertexManager,
            segmentPipeline,
            segmentBindGroup: null,
        };
    });
}
function hasRoundCap(points) {
    return points[0]?.strokeCap === 'round';
}
function dashPattern(points) {
    const dash = points[0]?.strokeDash;
    return Array.isArray(dash) && dash.length > 0 ? dash : undefined;
}
/**
 * Queues segment instances into the shared batch. The batch only merges draws
 * whose bind groups are the same object, so it is held rather than rebuilt.
 */
function queueSegments(device, ctx, res, rows, clip, blend = 'normal') {
    const pipeline = blend === 'normal'
        ? res.segmentPipeline
        : markPipeline(ctx, device, `${drawName$6} ${blend}`, 'SLine', res.segmentVertexManager, undefined, blend);
    const buffer = res.bufferManager.sharedUniformBuffer();
    if (res.segmentBindGroup === null || res.segmentBindGroup.buffer !== buffer) {
        res.segmentBindGroup = { group: createUniformBindGroup(drawName$6, device, pipeline, buffer), buffer };
    }
    ctx._renderQueue.setupBatch({
        device,
        vertexManager: res.segmentVertexManager,
        pipeline,
        clip,
        bindGroups: [res.segmentBindGroup.group],
    });
    ctx._renderQueue.queueBatchInstance(Array.from(rows));
}
/** True when the points can be drawn as they are, with no curve and no gaps. */
function isPolyline(points) {
    const interpolate = points[0]?.interpolate;
    return (!interpolate || interpolate === 'linear') && points.every(p => p.defined !== false);
}
/** Which cubic each interpolation is. Anything absent tessellates. */
const CURVE_OF = {
    basis: 'basis',
    bundle: 'basis',
    cardinal: 'bezier',
    'catmull-rom': 'bezier',
    monotone: 'bezier',
    natural: 'bezier',
};
/**
 * Where an undashed line draws. A square cap needs the tessellated path, since
 * only extrude-polyline draws one, and it outranks the rest. A recognised cubic
 * goes to the GPU as its own control points, so the stroke follows the real
 * curve instead of a flattened polyline. linear and the step family tessellate,
 * which is what gives their corners a join, and so does a line with gaps.
 */
function lineRoute(points) {
    if (points[0]?.strokeCap === 'square') {
        return 'path';
    }
    const interpolate = points[0]?.interpolate;
    const curve = interpolate === undefined ? undefined : CURVE_OF[interpolate];
    const whole = points.every(p => p.defined !== false);
    if (curve === 'basis' && points.length >= 3 && whole) {
        return 'basis';
    }
    if (curve === 'bezier' && points.length >= 2) {
        return 'bezier';
    }
    return isPolyline(points) ? 'segments' : 'path';
}
/**
 * Dashed lines are split into their drawn runs on the cpu and emitted as plain
 * segments. Curved lines are flattened through the path tessellation first, so
 * the same code covers both.
 */
function drawDashed(device, ctx, res, points, pattern, clip) {
    const first = points[0];
    const offset = first.strokeDashOffset ?? 0;
    const polylines = isPolyline(points)
        ? [points.map(p => [p.x || 0, p.y || 0])]
        : line$1(ctx, points).lines.map(line => line.map(p => [p[0], p[1]]));
    const runs = polylines.flatMap(line => dashPolyline(line, pattern, offset));
    const col = Color.from2(first.stroke, first.opacity, first.strokeOpacity);
    const data = segmentInstances(runs, col, first.strokeWidth ?? 1);
    if (!data) {
        return;
    }
    queueSegments(device, ctx, res, data, clip, blendKey(first.blend));
}
/**
 * Instance data for one curve: a span per B-spline segment plus the two
 * straight runs d3's basis opens and closes with. Control points are doubled
 * at each end, which is what puts the first span's start at (5*P0 + P1) / 6.
 *
 * `bundle` blends every point toward the straight chord by its tension first,
 * exactly as d3 does before running basis.
 */
function basisInstances(points) {
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
    const col = Color.from2(first.stroke, first.opacity, first.strokeOpacity);
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
    push(xs[0], ys[0], basis(0, 0, cx), basis(0, 0, cy), 0, 0, 0, 0, 1);
    const spans = cx.length - 3;
    for (let i = 0; i < spans; i++) {
        push(cx[i], cy[i], cx[i + 1], cy[i + 1], cx[i + 2], cy[i + 2], cx[i + 3], cy[i + 3], 0);
    }
    // and the straight run out of the last
    push(basis(spans - 1, 1, cx), basis(spans - 1, 1, cy), xs[n - 1], ys[n - 1], 0, 0, 0, 0, 1);
    return out;
}
/**
 * Instance data for a curve d3 writes as cubic Beziers, collected from the same
 * generator canvas draws through, so the control points are exactly its own.
 * A `moveTo` starts a run, which is how `defined: false` leaves its gaps.
 */
function bezierInstances(points) {
    const out = [];
    const first = points[0];
    const col = Color.from2(first.stroke, first.opacity, first.strokeOpacity);
    const width = first.strokeWidth ?? 1;
    let cx = 0;
    let cy = 0;
    lineSpans(points, {
        moveTo(x, y) {
            cx = x;
            cy = y;
        },
        lineTo(x, y) {
            out.push(cx, cy, x, y, 0, 0, 0, 0, col[0], col[1], col[2], col[3], width, 1);
            cx = x;
            cy = y;
        },
        bezierCurveTo(x1, y1, x2, y2, x, y) {
            out.push(cx, cy, x1, y1, x2, y2, x, y, col[0], col[1], col[2], col[3], width, 0);
            cx = x;
            cy = y;
        },
        closePath() { },
    });
    return out;
}
/**
 * Draws a cubic entirely on the GPU, with no tessellation. Batched, so a spec
 * whose curves are one faceted mark each still issues a single draw.
 */
function drawCurve(device, ctx, res, points, clip, kind) {
    const first = points[0];
    if (!first.stroke || (first.strokeWidth ?? 1) <= 0) {
        return;
    }
    const rows = CURVES[kind].instances(points);
    if (rows.length === 0) {
        return;
    }
    const pipeline = markPipeline(ctx, device, `${drawName$6} ${kind}`, CURVES[kind].shader, res.spanVertexManager);
    // The batch only merges draws whose bind groups are the same object, so this
    // is held rather than rebuilt per curve.
    const buffer = res.bufferManager.sharedUniformBuffer();
    let held = res.spanBindGroups.get(kind);
    if (!held || held.buffer !== buffer) {
        held = { group: createUniformBindGroup(`${drawName$6} ${kind}`, device, pipeline, buffer), buffer };
        res.spanBindGroups.set(kind, held);
    }
    ctx._renderQueue.setupBatch({
        device,
        vertexManager: res.spanVertexManager,
        pipeline,
        clip,
        vertexCount: 6 * CURVE_SUBDIVISIONS,
        bindGroups: [held.group],
    });
    ctx._renderQueue.queueBatchInstance(rows);
}
/** Curved or gapped lines go through the shared path tessellation. */
function drawPath(device, ctx, res, points, clip) {
    const first = points[0];
    const shapeGeom = line$1(ctx, points);
    const geometry = geometryForItem(ctx, { ...first, fill: undefined }, shapeGeom, true);
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
            createUniformBindGroup(`${drawName$6}Curve`, device, res.curvePipeline, res.bufferManager.sharedUniformBuffer()),
        ],
        clip,
    });
}
function draw$6(device, ctx, scene, vb) {
    const items = scene.items;
    if (!items?.length) {
        return;
    }
    const res = getResources$6(device, ctx, vb);
    const points = items;
    const clip = markClip(ctx, scene);
    const pattern = dashPattern(points);
    if (pattern) {
        drawDashed(device, ctx, res, points, pattern, clip);
        return;
    }
    const route = lineRoute(points);
    if (route === 'path') {
        drawPath(device, ctx, res, points, clip);
        return;
    }
    if (route !== 'segments') {
        drawCurve(device, ctx, res, points, clip, route);
        return;
    }
    if (points.length < 2) {
        return; // a single point has no segment to draw
    }
    queueSegments(device, ctx, res, createAttributes$1(points), clip, blendKey(points[0]?.blend));
}
/**
 * Segments of one polyline. Only the earlier segment of an interior vertex
 * rounds its end: that half disc is the round join, and rounding the later
 * segment's start too would blend the same disc twice. A round stroke cap
 * rounds the two outer ends as well.
 */
function createAttributes$1(points) {
    const result = new Float32Array((points.length - 1) * SEGMENT_STRIDE);
    // A line mark carries one stroke, which is the first item's; canvas strokes
    // the whole path with it. Resolving the colour per segment showed up as the
    // largest single cost on a spec with many short lines.
    const first = points[0];
    const col = Color.from2(first.stroke, first.opacity ?? 1, first.strokeOpacity ?? 1);
    const strokeWidth = first.strokeWidth ?? 1;
    const round = hasRoundCap(points) ? 1 : 0;
    const last = points.length - 2;
    for (let i = 0; i <= last; i++) {
        const index = i * SEGMENT_STRIDE;
        result[index] = points[i].x || 0;
        result[index + 1] = points[i].y || 0;
        result[index + 2] = points[i + 1].x || 0;
        result[index + 3] = points[i + 1].y || 0;
        result[index + 4] = col[0];
        result[index + 5] = col[1];
        result[index + 6] = col[2];
        result[index + 7] = col[3];
        result[index + 8] = strokeWidth;
        result[index + 9] = i === 0 ? round : 0;
        result[index + 10] = i < last ? 1 : round;
    }
    return result;
}
var line = {
    type: 'line',
    draw: draw$6,
};

const drawName$5 = 'Path';
function getResources$5(device, ctx, vb) {
    return getMarkResources(ctx, 'path', device, vb, () => {
        const bufferManager = new BufferManager(device, drawName$5, ctx._uniforms.resolution, [vb.x1, vb.y1]);
        const vertexManager = new VertexBufferManager(['float32x3', 'float32x4']);
        const pipeline = markPipeline(ctx, device, drawName$5, 'SolidFill', vertexManager);
        // blend needs its own pipeline, and markPipeline caches them by mode
        const pipelineFor = (blend) => blend === 'normal'
            ? pipeline
            : markPipeline(ctx, device, `${drawName$5} ${blend}`, 'SolidFill', vertexManager, undefined, blend);
        const gradientPipeline = markPipeline(ctx, device, `${drawName$5}Gradient`, 'GradientFill', vertexManager);
        // a gradient fill under a blend needs its own pipeline too
        const gradientPipelineFor = (blend) => blend === 'normal'
            ? gradientPipeline
            : markPipeline(ctx, device, `${drawName$5}Gradient ${blend}`, 'GradientFill', vertexManager, undefined, blend);
        return { device, bufferManager, vertexManager, pipeline, pipelineFor, gradientPipelineFor, cache: new Map() };
    });
}
function draw$5(device, ctx, scene, vb) {
    const items = scene.items;
    if (!items?.length) {
        return;
    }
    const res = getResources$5(device, ctx, vb);
    const uniformBuffer = res.bufferManager.createUniformBuffer();
    const clip = markClip(ctx, scene);
    const vertexLength = res.vertexManager.getVertexLength();
    const gradientTarget = {
        ctx,
        device,
        name: `${drawName$5}Gradient`,
        pipelineFor: res.gradientPipelineFor,
        bufferManager: res.bufferManager,
        uniformBuffer,
        vertexLength,
        clip,
    };
    // Solid fills and strokes share one pipeline and are accumulated in paint
    // order into a single buffer/draw. Gradient fills interrupt the batch.
    const batch = new GeometryBatch();
    // one batch draws with one pipeline, so a change of blend closes it
    let batchBlend = 'normal';
    const flushBatch = () => {
        const data = batch.flush();
        if (data) {
            const pipeline = res.pipelineFor(batchBlend);
            ctx._renderQueue.enqueue({
                pipeline,
                drawCounts: [data.length / vertexLength],
                vertexBuffers: [res.bufferManager.createGeometryBuffer(data)],
                bindGroups: [createUniformBindGroup(drawName$5, device, pipeline, uniformBuffer)],
                clip,
            });
        }
    };
    for (const item of items) {
        const blend = blendKey(item.blend);
        if (blend !== batchBlend) {
            flushBatch();
            batchBlend = blend;
        }
        const bounds = item.bounds;
        const gradient = isGradient(item.fill) && bounds ? item.fill : null;
        const fill = gradient
            ? whiteCarrier(item.opacity, item.fillOpacity)
            : Color.from2(item.fill, item.opacity, item.fillOpacity);
        const strokeGradient = isGradient(item.stroke) && bounds ? item.stroke : null;
        const stroke = strokeGradient
            ? whiteCarrier(item.opacity, item.strokeOpacity)
            : Color.from2(item.stroke, item.opacity, item.strokeOpacity);
        const [fillData, strokeData] = cachedGeometryData(res.cache, item, fill, stroke, () => {
            const shapeGeom = geometryForPath(ctx, item.path);
            // path items carry their own translation, rotation and scale
            const geometry = geometryForItem(ctx, item, shapeGeom, false, item.x || 0, item.y || 0, {
                angle: ((item.angle || 0) * Math.PI) / 180,
                scaleX: item.scaleX ?? 1,
                scaleY: item.scaleY ?? 1,
            });
            return geometryVertexData(geometry, fill, stroke);
        });
        if (fillData.length > 0 && gradient && bounds) {
            flushBatch();
            enqueueGradient(gradientTarget, fillData, gradient, bounds, blendKey(item.blend));
        }
        else {
            batch.push(fillData);
        }
        if (strokeData.length > 0 && strokeGradient && bounds) {
            flushBatch();
            enqueueGradient(gradientTarget, strokeData, strokeGradient, bounds, blendKey(item.blend));
        }
        else {
            batch.push(strokeData);
        }
    }
    flushBatch();
}
var path = {
    type: 'path',
    draw: draw$5,
};

const drawName$4 = 'Rule';
function getResources$4(device, ctx, vb) {
    return getMarkResources(ctx, 'rule', device, vb, () => {
        const bufferManager = new BufferManager(device, drawName$4, ctx._uniforms.resolution, [vb.x1, vb.y1]);
        const vertexManager = new VertexBufferManager(['float32x2'], // position
        // center, scale, color, half-thickness offset
        ['float32x2', 'float32x2', 'float32x4', 'float32x2']);
        const pipeline = markPipeline(ctx, device, drawName$4, drawName$4, vertexManager);
        // A rule with both x2 and y2 set is a diagonal segment, which an
        // axis-aligned quad cannot express. Those go through the single-segment
        // line shader instead.
        const diagonalVertexManager = new VertexBufferManager([], SEGMENT_LAYOUT);
        const diagonalPipeline = markPipeline(ctx, device, `${drawName$4}Diagonal`, 'SLine', diagonalVertexManager);
        const geometryBuffer = bufferManager.createGeometryBuffer(quadVertex, undefined, true);
        return { device, bufferManager, vertexManager, pipeline, diagonalPipeline, geometryBuffer };
    });
}
/** True when the rule runs at an angle, so it cannot be drawn as a rect. */
function isDiagonal(item) {
    const x = item.x || 0;
    const y = item.y || 0;
    return (item.x2 ?? x) !== x && (item.y2 ?? y) !== y;
}
function draw$4(device, ctx, scene, vb) {
    const items = scene.items;
    if (!items?.length) {
        return;
    }
    const res = getResources$4(device, ctx, vb);
    const uniformBuffer = res.bufferManager.createUniformBuffer();
    const clip = markClip(ctx, scene);
    let run = [];
    let runBlend = 'normal';
    const flushRun = () => {
        if (run.length === 0) {
            return;
        }
        const pipeline = runBlend === 'normal'
            ? res.pipeline
            : markPipeline(ctx, device, `${drawName$4} ${runBlend}`, drawName$4, res.vertexManager, undefined, runBlend);
        const instanceBuffer = res.bufferManager.createInstanceBuffer(createAttributes(run));
        ctx._renderQueue.enqueue({
            pipeline,
            drawCounts: [6, run.length],
            vertexBuffers: [res.geometryBuffer, instanceBuffer],
            bindGroups: [createUniformBindGroup(drawName$4, device, pipeline, uniformBuffer)],
            clip,
        });
        run = [];
    };
    for (const item of items) {
        const blend = blendKey(item.blend);
        if (blend !== runBlend && run.length > 0) {
            flushRun();
        }
        runBlend = blend;
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
            bindGroups: [createUniformBindGroup(`${drawName$4}Diagonal`, device, res.diagonalPipeline, uniformBuffer)],
            clip,
        });
    }
    flushRun();
}
function createAttributes(items) {
    return Float32Array.from(items.flatMap(item => {
        const { x2, y2, stroke, strokeWidth = 1, opacity = 1, strokeOpacity = 1 } = item;
        const x = item.x || 0;
        const y = item.y || 0;
        const ex = x2 == null ? x : x2 || 0;
        const ey = y2 == null ? y : y2 || 0;
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
function createDiagonalAttributes(item) {
    const { x2, y2, stroke, strokeWidth = 1, opacity = 1, strokeOpacity = 1 } = item;
    const x = item.x || 0;
    const y = item.y || 0;
    const col = Color.from2(stroke, opacity, strokeOpacity);
    return segmentInstance(x, y, x2 == null ? x : x2 || 0, y2 == null ? y : y2 || 0, col, strokeWidth);
}
var rule = {
    type: 'rule',
    draw: draw$4,
};

const drawName$3 = 'Shape';
// Bounds the per-context geometry cache so a long streaming session, where
// every frame brings new datum ids, cannot grow it without limit.
const MAX_CACHE = 4096;
/** Every interior vertex of a contour gets a round join on the earlier end. */
const CONTOUR_CAPS = [0, 1];
function getResources$3(device, ctx, vb) {
    return getMarkResources(ctx, 'shape', device, vb, () => {
        const bufferManager = new BufferManager(device, drawName$3, ctx._uniforms.resolution, [vb.x1, vb.y1]);
        const vertexManager = new VertexBufferManager(['float32x3', 'float32x4'], // position, color
        []);
        const pipeline = markPipeline(ctx, device, drawName$3, 'SolidFill', vertexManager);
        // blend needs its own pipeline, and markPipeline caches them by mode
        const pipelineFor = (blend) => blend === 'normal'
            ? pipeline
            : markPipeline(ctx, device, `${drawName$3} ${blend}`, 'SolidFill', vertexManager, undefined, blend);
        const gradientPipeline = markPipeline(ctx, device, `${drawName$3}Gradient`, 'GradientFill', vertexManager);
        // a gradient fill under a blend needs its own pipeline too
        const gradientPipelineFor = (blend) => blend === 'normal'
            ? gradientPipeline
            : markPipeline(ctx, device, `${drawName$3}Gradient ${blend}`, 'GradientFill', vertexManager, undefined, blend);
        const segmentVertexManager = new VertexBufferManager([], SEGMENT_LAYOUT);
        const segmentPipeline = markPipeline(ctx, device, `${drawName$3}Stroke`, 'SLine', segmentVertexManager);
        return {
            device,
            bufferManager,
            vertexManager,
            pipeline,
            pipelineFor,
            gradientPipelineFor,
            segmentVertexManager,
            segmentPipeline,
            outlines: new OutlineBuffer(),
            outlineState: new WeakMap(),
            cache: new Map(),
        };
    });
}
function draw$3(device, ctx, scene, vb) {
    const items = scene.items;
    if (!items?.length) {
        return;
    }
    const res = getResources$3(device, ctx, vb);
    const uniformBuffer = res.bufferManager.createUniformBuffer();
    const useCache = ctx._renderer.wgOptions.cacheShapes ?? false;
    const clip = markClip(ctx, scene);
    const vertexLength = res.vertexManager.getVertexLength();
    const gradientTarget = {
        ctx,
        device,
        name: `${drawName$3}Gradient`,
        pipelineFor: res.gradientPipelineFor,
        bufferManager: res.bufferManager,
        uniformBuffer,
        vertexLength,
        clip,
    };
    // Solid fills and strokes share one pipeline and are accumulated in paint
    // order into a single buffer/draw. Gradient fills interrupt the batch.
    const batch = new GeometryBatch();
    // one batch draws with one pipeline, so a change of blend closes it
    let batchBlend = 'normal';
    // Outlines accumulate separately and draw after the fills. A sub pixel
    // stroke on a triangulated ribbon takes its coverage from MSAA, which can
    // only express quarter steps, so a 0.2 px country border came out patchy.
    const outlines = res.outlines;
    outlines.length = 0;
    // An outline only has to be rebuilt when something it is drawn from moved or
    // changed colour, which on a stroked choropleth is the difference between
    // rewriting a few hundred thousand segments a frame and rewriting none.
    let outlinesHeld = true;
    const flushBatch = () => {
        const data = batch.flush();
        if (data) {
            const pipeline = res.pipelineFor(batchBlend);
            ctx._renderQueue.enqueue({
                pipeline,
                drawCounts: [data.length / vertexLength],
                vertexBuffers: [res.bufferManager.createGeometryBuffer(data)],
                bindGroups: [createUniformBindGroup(drawName$3, device, pipeline, uniformBuffer)],
                clip,
            });
        }
    };
    for (const item of items) {
        const blend = blendKey(item.blend);
        if (blend !== batchBlend) {
            flushBatch();
            batchBlend = blend;
        }
        const bounds = item.bounds;
        const gradient = isGradient(item.fill) && bounds ? item.fill : null;
        // A gradient stroke samples the ramp per fragment, which the segment shader
        // cannot do, so it keeps the triangulated ribbon and the gradient pipeline.
        const strokeGradient = isGradient(item.stroke) && bounds ? item.stroke : null;
        let shapeGeom = null;
        const geom = () => (shapeGeom ??= shape$1(ctx, item));
        const [fillData, strokeData, lines, unchanged] = createGeometryData(ctx, res, item, gradient !== null, strokeGradient !== null, useCache, geom);
        if (fillData.length > 0 && gradient && bounds) {
            flushBatch();
            enqueueGradient(gradientTarget, fillData, gradient, bounds, blendKey(item.blend));
        }
        else {
            batch.push(fillData);
        }
        if (strokeData.length > 0 && strokeGradient && bounds) {
            flushBatch();
            enqueueGradient(gradientTarget, strokeData, strokeGradient, bounds, blendKey(item.blend));
        }
        else {
            batch.push(strokeData);
            outlinesHeld &&= unchanged;
            pushOutline(outlines, item, lines);
        }
    }
    flushBatch();
    const state = res.outlineState.get(scene) ?? { buffer: null, capacity: 0, length: -1 };
    res.outlineState.set(scene, state);
    const heldOutline = outlinesHeld && outlines.length === state.length && state.buffer !== null;
    state.length = outlines.length;
    if (outlines.length > 0) {
        ctx._renderQueue.enqueue({
            pipeline: res.segmentPipeline,
            drawCounts: [6, outlines.length / SEGMENT_STRIDE],
            vertexBuffers: [outlineBuffer(device, state, outlines, heldOutline)],
            bindGroups: [createUniformBindGroup(`${drawName$3}Stroke`, device, res.segmentPipeline, uniformBuffer)],
            clip,
        });
    }
}
/** Appends one item's outline, contour by contour, as segment instances. */
function pushOutline(out, item, lines) {
    const width = item.strokeWidth ?? 1;
    if (!item.stroke || width <= 0) {
        return;
    }
    const color = Color.from2(item.stroke, item.opacity, item.strokeOpacity);
    if (color[3] <= 0) {
        return;
    }
    const needed = segmentCount(lines) * SEGMENT_STRIDE;
    if (needed === 0) {
        return;
    }
    out.length = writeSegments(out.reserve(needed), out.length, lines, color, width, CONTOUR_CAPS);
}
/**
 * The scene's own outline buffer, rewritten only when the outline changed.
 * writeBuffer is ordered on the queue, so a rewrite lands after the previous
 * frame's draws have read it.
 */
function outlineBuffer(device, state, outlines, held) {
    const bytes = new Uint8Array(outlines.data.buffer, 0, outlines.length * 4);
    if (state.buffer && held) {
        return state.buffer;
    }
    if (!state.buffer || state.capacity < bytes.byteLength) {
        let capacity = Math.max(bytes.byteLength, 4096);
        if (state.buffer) {
            capacity = Math.max(capacity, state.capacity * 2);
        }
        state.buffer = device.createBuffer({
            label: `${drawName$3} Outline`,
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
/**
 * The item itself, which vega keeps across re-renders of the same tuple. A
 * datum id is not unique: a county split across several polygons is several
 * items sharing one id, and they would then share one entry.
 */
function cacheKey(item) {
    return item;
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
function createGeometryData(ctx, res, item, hasGradient, strokeIsGradient, useCache, geom) {
    const key = cacheKey(item);
    const fill = hasGradient
        ? whiteCarrier(item.opacity, item.fillOpacity)
        : Color.from2(item.fill, item.opacity, item.fillOpacity);
    const stroke = strokeIsGradient
        ? whiteCarrier(item.opacity, item.strokeOpacity)
        : Color.from2(item.stroke, item.opacity, item.strokeOpacity);
    if (useCache) {
        const entry = res.cache.get(key);
        if (entry &&
            strokeIsGradient === entry.strokeIsGradient &&
            item.strokeWidth === entry.strokeWidth &&
            item.x === entry.x &&
            item.y === entry.y &&
            sameBounds(item.bounds, entry.bounds)) {
            // re-insert to keep the map in least-recently-used order
            res.cache.delete(key);
            res.cache.set(key, entry);
            if (sameColor(entry.fill, fill) && sameColor(entry.stroke, stroke)) {
                return [entry.data[0], entry.data[1], entry.lines, true];
            }
            // geometry unchanged, rewrite only the colors
            const data = [
                new Float32Array(entry.data[0].length),
                new Float32Array(entry.data[1].length),
            ];
            recolor(data[0], entry.data[0], fill);
            recolor(data[1], entry.data[1], stroke);
            return [data[0], data[1], entry.lines, false];
        }
    }
    // the outline draws as segments, so the triangulation only builds the fill
    const shapeGeom = geom();
    const geometry = geometryForItem(ctx, strokeIsGradient ? item : { ...item, stroke: undefined }, shapeGeom);
    const data = geometryVertexData(geometry, fill, stroke);
    if (useCache) {
        if (res.cache.size >= MAX_CACHE) {
            const oldest = res.cache.keys().next().value;
            if (oldest !== undefined) {
                res.cache.delete(oldest);
            }
        }
        res.cache.set(key, {
            fill,
            stroke,
            x: item.x,
            y: item.y,
            bounds: copyBounds(item.bounds),
            strokeWidth: item.strokeWidth,
            strokeIsGradient,
            data,
            lines: shapeGeom.lines,
        });
    }
    return [data[0], data[1], shapeGeom.lines, false];
}
function copyBounds(b) {
    return b ? { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 } : undefined;
}
function sameBounds(b, snap) {
    if (b === undefined || snap === undefined) {
        return b === undefined && snap === undefined;
    }
    return sameEdge(b.x1, snap.x1) && sameEdge(b.y1, snap.y1) && sameEdge(b.x2, snap.x2) && sameEdge(b.y2, snap.y2);
}
/**
 * A projection can send a shape outside its domain and leave NaN in the bounds,
 * which never equals itself, so those items would rebuild on every frame.
 */
function sameEdge(a, b) {
    return a === b || (Number.isNaN(a) && Number.isNaN(b));
}
var shape = {
    type: 'shape',
    draw: draw$3,
};

const drawName$2 = 'Symbol';
// Bounds the triangulated-shape cache. `size` is continuous, so a size-encoded
// chart would otherwise mint a GPU buffer per distinct size, forever.
const MAX_SHAPE_CACHE = 256;
function getResources$2(device, ctx, vb) {
    return getMarkResources(ctx, 'symbol', device, vb, () => {
        const bufferManager = new BufferManager(device, drawName$2, ctx._uniforms.resolution, [vb.x1, vb.y1]);
        const circleVertexManager = new VertexBufferManager(['float32x2'], // position
        // center, radius, fill color, stroke color, stroke width
        ['float32x2', 'float32', 'float32x4', 'float32x4', 'float32']);
        const circlePipeline = markPipeline(ctx, device, drawName$2, drawName$2, circleVertexManager);
        const shapeVertexManager = new VertexBufferManager(['float32x2'], // geometry position (centered on origin)
        ['float32x2', 'float32x4', 'float32']);
        const shapePipeline = markPipeline(ctx, device, `${drawName$2}Shape`, 'SymbolShape', shapeVertexManager);
        const circleGeometry = bufferManager.createGeometryBuffer(createCircleGeometry(), undefined, true);
        const sdfVertexManager = new VertexBufferManager(['float32x2'], // unit quad position
        // center, size, fill color, stroke color, stroke width, angle
        ['float32x2', 'float32', 'float32x4', 'float32x4', 'float32', 'float32']);
        const quadGeometry = bufferManager.createGeometryBuffer(Float32Array.from([-1, -1, -1, 1, 1, -1, 1, -1, -1, 1, 1, 1]), undefined, true);
        const colorVertexManager = new VertexBufferManager(['float32x3', 'float32x4']); // position, color
        const solidPipeline = markPipeline(ctx, device, `${drawName$2}Solid`, 'SolidFill', colorVertexManager);
        const gradientPipeline = markPipeline(ctx, device, `${drawName$2}Gradient`, 'GradientFill', colorVertexManager);
        // a gradient fill under a blend needs its own pipeline too
        const gradientPipelineFor = (blend) => blend === 'normal'
            ? gradientPipeline
            : markPipeline(ctx, device, `${drawName$2}Gradient ${blend}`, 'GradientFill', colorVertexManager, undefined, blend);
        return {
            device,
            bufferManager,
            circleVertexManager,
            circlePipeline,
            circleGeometry,
            shapePipeline,
            shapeCache: new Map(),
            sdfVertexManager,
            sdfPipelines: new Map(),
            quadGeometry,
            colorVertexManager,
            solidPipeline,
            gradientPipelineFor,
        };
    });
}
function draw$2(device, ctx, scene, vb) {
    const items = scene.items;
    if (!items?.length) {
        return;
    }
    const res = getResources$2(device, ctx, vb);
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
        const [kindPart, runBlend = 'normal'] = runKind.split('!');
        if (kindPart === 'circle') {
            const circlePipeline = runBlend === 'normal'
                ? res.circlePipeline
                : markPipeline(ctx, device, `${drawName$2} ${runBlend}`, drawName$2, res.circleVertexManager, undefined, runBlend);
            circleBindGroup ??= createUniformBindGroup(drawName$2, device, circlePipeline, uniformBuffer);
            const instanceBuffer = res.bufferManager.createInstanceBuffer(createCircleAttributes(run));
            ctx._renderQueue.enqueue({
                pipeline: circlePipeline,
                drawCounts: [6, run.length],
                vertexBuffers: [res.circleGeometry, instanceBuffer],
                bindGroups: [circleBindGroup],
                clip,
            });
        }
        else if (kindPart.startsWith('sdf|')) {
            const shape = kindPart.slice(4);
            const pipeline = sdfPipeline(device, ctx, res, shape, runBlend);
            const instanceBuffer = res.bufferManager.createInstanceBuffer(createSdfAttributes(run));
            ctx._renderQueue.enqueue({
                pipeline,
                drawCounts: [6, run.length],
                vertexBuffers: [res.quadGeometry, instanceBuffer],
                bindGroups: [createUniformBindGroup(`${drawName$2}Sdf`, device, pipeline, uniformBuffer)],
                clip,
            });
        }
        else {
            shapeBindGroup ??= createUniformBindGroup(`${drawName$2}Shape`, device, res.shapePipeline, uniformBuffer);
            drawShapeGroup(device, ctx, res, shapeBindGroup, kindPart, run, clip);
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
        // Shapes with a distance function are one instanced quad each, so a run can
        // hold any mix of sizes, stroke widths and angles.
        const blend = blendKey(item.blend);
        const kind = (shape === 'circle'
            ? 'circle'
            : hasSdf(shape)
                ? `sdf|${shape}`
                : `${shape}|${item.size ?? 64}|${item.stroke ? (item.strokeWidth ?? 1) : 0}`) + `!${blend}`;
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
        const gradientPipeline = res.gradientPipelineFor(blendKey(item.blend));
        ctx._renderQueue.enqueue({
            pipeline: gradientPipeline,
            drawCounts: [fillData.length / vertexLength],
            vertexBuffers: [res.bufferManager.createGeometryBuffer(fillData)],
            bindGroups: [
                createUniformBindGroup(`${drawName$2}Gradient`, device, gradientPipeline, uniformBuffer),
                createGradientBindGroup(gres, gradientPipeline, item.fill, gradientBounds(ctx, bounds)),
            ],
            clip,
        });
    }
    if (strokeData.length > 0) {
        ctx._renderQueue.enqueue({
            pipeline: res.solidPipeline,
            drawCounts: [strokeData.length / vertexLength],
            vertexBuffers: [res.bufferManager.createGeometryBuffer(strokeData)],
            bindGroups: [createUniformBindGroup(`${drawName$2}Solid`, device, res.solidPipeline, uniformBuffer)],
            clip,
        });
    }
}
const DEG_TO_RAD$1 = Math.PI / 180;
/** Builds [centerX, centerY, r, g, b, a, angle] instance rows for items passing `keep`. */
function instanceData(group, color, keep) {
    const rows = [];
    let count = 0;
    for (const item of group) {
        if (!keep(item)) {
            continue;
        }
        const c = color(item);
        rows.push(item.x || 0, item.y || 0, c[0], c[1], c[2], c[3], (item.angle || 0) * DEG_TO_RAD$1);
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
/** Instance data for the analytic shapes: one quad each, no triangulation. */
/** Floats per sdf instance: centre, size, fill, stroke, width, angle. */
const SDF_STRIDE = 13;
/**
 * One scratch array the instance builders write into, so a mark does not mint
 * a new one every frame. createBuffer copies through writeBuffer before it
 * returns, so the next builder is free to overwrite it. At 300k symbols this is
 * 13.7 MB a frame that no longer has to be allocated and collected.
 */
let scratch = new Float32Array(0);
function scratchFor(length) {
    if (scratch.length < length) {
        scratch = new Float32Array(length);
    }
    return scratch.subarray(0, length);
}
function createSdfAttributes(items) {
    const result = scratchFor(items.length * SDF_STRIDE);
    for (let i = 0, len = items.length; i < len; i++) {
        const item = items[i];
        const { fill, stroke, strokeWidth = 1, opacity = 1, fillOpacity = 1, strokeOpacity = 1 } = item;
        const base = i * SDF_STRIDE;
        result[base] = item.x || 0;
        result[base + 1] = item.y || 0;
        result[base + 2] = Math.sqrt(item.size ?? 64);
        Color.write(result, base + 3, fill, opacity, fillOpacity);
        Color.write(result, base + 7, stroke, opacity, strokeOpacity);
        result[base + 11] = stroke ? strokeWidth : 0;
        result[base + 12] = ((item.angle || 0) * Math.PI) / 180;
    }
    return result;
}
/** Pipeline for one analytic shape, compiled on first use. */
function sdfPipeline(device, ctx, res, shape, blend = 'normal') {
    const cacheKey = `${shape}!${blend}`;
    let pipeline = res.sdfPipelines.get(cacheKey);
    if (!pipeline) {
        pipeline = markPipeline(ctx, device, `${drawName$2}Sdf ${shape}`, symbolSdfKey(shape), res.sdfVertexManager, undefined, blend);
        res.sdfPipelines.set(cacheKey, pipeline);
    }
    return pipeline;
}
/** Floats per circle instance: centre, radius, fill, stroke, width. */
const CIRCLE_STRIDE = 12;
function createCircleAttributes(items) {
    const result = scratchFor(items.length * CIRCLE_STRIDE);
    for (let i = 0, len = items.length; i < len; i++) {
        const item = items[i];
        const { fill, stroke, strokeWidth = 1, opacity = 1, fillOpacity = 1, strokeOpacity = 1 } = item;
        const base = i * CIRCLE_STRIDE;
        result[base] = item.x || 0;
        result[base + 1] = item.y || 0;
        result[base + 2] = Math.sqrt(item.size ?? 64) / 2;
        Color.write(result, base + 3, fill, opacity, fillOpacity);
        Color.write(result, base + 7, stroke, opacity, strokeOpacity);
        result[base + 11] = stroke ? strokeWidth : 0;
    }
    return result;
}
function createCircleGeometry() {
    return new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
}
var symbol = {
    type: 'symbol',
    draw: draw$2,
};

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
    /** Called with a texture the atlas has replaced, which a queued draw may still hold. */
    onRelease = null;
    constructor(_device) {
        this._device = _device;
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
        this._device.queue.copyExternalImageToTexture({ source: this._canvas, origin: [x0, y0] }, { texture: this._texture, origin: [x0, y0], premultipliedAlpha: true }, [x1 - x0, y1 - y0]);
    }
    destroy() {
        this._texture.destroy();
        this._slots.clear();
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
            const old = this._texture;
            if (this.onRelease) {
                this.onRelease(old);
            }
            else {
                old.destroy();
            }
        }
        this._slots.clear();
        this._shelfY = 0;
        this._shelfHeight = 0;
        this._cursorX = 0;
        this._dirty = null;
        this._spilled = false;
        this._texture = this._device.createTexture({
            label: 'Text Atlas',
            size: [size, size, 1],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });
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
const textMark = Marks.text;
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
const DEG_TO_RAD = Math.PI / 180;
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
 * Cache key over everything that affects the rasterized pixels (not opacity,
 * which the shader applies). `radius`/`theta` are not included, because they
 * only move the anchor in scene space and cancel out of the anchor-relative
 * offset. `angle` is, and is zero for a glyph the quad will turn instead.
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
 * Size of `raster`'s rasterization and where its anchor sits inside it. The
 * anchor offset is picked so that turning the quad about the anchor puts the
 * glyph's top-left corner on a whole device pixel, which for a quarter turn
 * maps every texel onto exactly one pixel, and for no turn at all reproduces
 * what the canvas renderer rasterizes.
 */
function glyphMetrics(ctx, raster, vb, turn) {
    const dpi = ctx._uniforms.dpi || 1;
    const b = textMark.bound(new Bounds(), raster, 0);
    const [ax, ay] = textAnchor(raster);
    // At least 1px clearance so antialiased edges are never clipped.
    const padLeft = Math.ceil(Math.max(0, (ax - b.x1) * dpi)) + 1;
    const padTop = Math.ceil(Math.max(0, (ay - b.y1) * dpi)) + 1;
    const [anchorTexX, anchorTexY] = anchorOffset((ax - vb.x1) * dpi, (ay - vb.y1) * dpi, padLeft, padTop, turn);
    const physWidth = Math.ceil(anchorTexX + (b.x2 - ax) * dpi) + 1;
    const physHeight = Math.ceil(anchorTexY + (b.y2 - ay) * dpi) + 1;
    if (physWidth <= 0 || physHeight <= 0) {
        return null;
    }
    return { physWidth, physHeight, anchorTexX, anchorTexY };
}
const NO_TURN = [1, 0];
/** Cosine and sine of an item's angle, which vega stores in degrees. */
function turnOf(item) {
    const a = (item.angle || 0) * DEG_TO_RAD;
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
    textMark.draw(c2d, { items: [{ ...raster, opacity: 1 }] }, null);
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
    const texture = device.createTexture({
        label: 'Text Texture',
        size: [m.physWidth, m.physHeight, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: canvas }, { texture, premultipliedAlpha: true }, [
        m.physWidth,
        m.physHeight,
    ]);
    return { texture, ...m };
}

const drawName$1 = 'Text';
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
function getResources$1(device, ctx, vb) {
    return getMarkResources(ctx, 'text', device, vb, () => {
        const bufferManager = new BufferManager(device, drawName$1, ctx._uniforms.resolution, [vb.x1, vb.y1]);
        const vertexManager = new VertexBufferManager([], LABEL_LAYOUT);
        const pipeline = markPipeline(ctx, device, drawName$1, drawName$1, vertexManager);
        const sampler = device.createSampler({
            label: 'Text Sampler',
            magFilter: 'linear',
            minFilter: 'linear',
        });
        const atlas = new TextAtlas(device);
        atlas.onRelease = texture => ctx._renderer?.deferDestroy(texture);
        const scratch = document.createElement('canvas');
        const scratchCtx = scratch.getContext('2d');
        return {
            device,
            bufferManager,
            vertexManager,
            pipeline,
            sampler,
            atlas,
            exact: true,
            scratch,
            scratchCtx,
        };
    });
}
/**
 * Slot for one rasterization of a label. On a miss it draws the label into the
 * atlas, unless `rasterize` is false, which asks only whether it is already
 * there.
 */
function getSlot(ctx, res, raster, vb, turn, rasterize) {
    const dpi = ctx._uniforms.dpi || 1;
    const metrics = glyphMetrics(ctx, raster, vb, turn);
    if (!metrics) {
        return null;
    }
    const key = `${textCacheKey(raster)}|${dpi}|${metrics.anchorTexX}|${metrics.anchorTexY}`;
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
        const slot = getSlot(ctx, res, item, vb, NO_TURN);
        return slot && { slot, turn: NO_TURN };
    }
    const slot = getSlot(ctx, res, upright(item), vb, turn);
    return slot && { slot, turn };
}
/**
 * Places one label's quad, in logical pixels. The offsets are not rounded here:
 * glyphMetrics already chose the anchor offset that lands the turned corner on
 * a whole device pixel.
 */
function labelRect(vb, dpi, item, m) {
    const [ax, ay] = textAnchor(item);
    const originPhysX = (ax - vb.x1) * dpi - m.anchorTexX;
    const originPhysY = (ay - vb.y1) * dpi - m.anchorTexY;
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
function draw$1(device, ctx, scene, vb) {
    const items = scene.items;
    if (!items?.length) {
        return;
    }
    const res = getResources$1(device, ctx, vb);
    const clip = markClip(ctx, scene);
    const dpi = ctx._uniforms.dpi || 1;
    // Atlas coordinates stay in pixels until the batch closes: the first
    // allocation may grow the atlas, and every slot in a batch shares its size.
    const settling = ctx._renderer?.settling === true;
    const exact = settling || res.exact;
    let deferred = false;
    res.atlas.begin();
    // Atlas coordinates stay in pixels until the batch closes, since begin may
    // have resized it and every slot in a batch shares one size.
    const packed = [];
    const oversized = [];
    for (const item of items) {
        const opacity = item.opacity == null ? 1 : item.opacity;
        if (opacity === 0 || (item.fontSize ?? 11) <= 0 || item.text == null || String(item.text).length === 0) {
            continue;
        }
        const [ax, ay] = textAnchor(item);
        const turn = turnOf(item);
        const placed = place(ctx, res, item, vb, turn, exact);
        deferred ||= placed !== null && placed.turn !== NO_TURN;
        if (placed) {
            const { slot } = placed;
            const [x1, y1, x2, y2] = labelRect(vb, dpi, item, slot);
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
        const tex = rasterizeText(device, res.scratch, res.scratchCtx, dpi, raster, metrics);
        ctx._renderer?.deferDestroy(tex.texture);
        const [x1, y1, x2, y2] = labelRect(vb, dpi, item, metrics);
        const [cos, sin] = spun ? turn : NO_TURN;
        oversized.push({
            texture: tex.texture,
            data: Float32Array.from([x1, y1, x2, y2, 0, 0, 1, 1, ax, ay, cos, sin, opacity]),
        });
    }
    const t0 = performance.now();
    res.atlas.flush();
    if (!settling && performance.now() - t0 > UPLOAD_BUDGET_MS) {
        res.exact = false;
    }
    if (deferred) {
        ctx._renderer?.requestSettle();
    }
    const size = res.atlas.size;
    for (let i = 0; i < packed.length; i += LABEL_STRIDE) {
        packed[i + 4] /= size;
        packed[i + 5] /= size;
        packed[i + 6] /= size;
        packed[i + 7] /= size;
    }
    const uniformBuffer = res.bufferManager.sharedUniformBuffer();
    const uniformBindGroup = createUniformBindGroup(drawName$1, device, res.pipeline, uniformBuffer);
    const enqueue = (texture, data) => {
        ctx._renderQueue.enqueue({
            pipeline: res.pipeline,
            drawCounts: [6, data.length / LABEL_STRIDE],
            vertexBuffers: [res.bufferManager.createInstanceBuffer(data)],
            bindGroups: [
                uniformBindGroup,
                device.createBindGroup({
                    label: 'Text Texture Bind Group',
                    layout: res.pipeline.getBindGroupLayout(1),
                    entries: [
                        { binding: 0, resource: res.sampler },
                        { binding: 1, resource: texture.createView() },
                    ],
                }),
            ],
            clip,
        });
    };
    if (packed.length > 0) {
        enqueue(res.atlas.texture, Float32Array.from(packed));
    }
    for (const extra of oversized) {
        enqueue(extra.texture, extra.data);
    }
}
var text = {
    type: 'text',
    draw: draw$1,
};

const drawName = 'Trail';
function getResources(device, ctx, vb) {
    return getMarkResources(ctx, 'trail', device, vb, () => {
        const bufferManager = new BufferManager(device, drawName, ctx._uniforms.resolution, [vb.x1, vb.y1]);
        const vertexManager = new VertexBufferManager(['float32x3', 'float32x4'], // position, color
        []);
        const pipeline = markPipeline(ctx, device, drawName, 'SolidFill', vertexManager);
        // blend needs its own pipeline, and markPipeline caches them by mode
        const pipelineFor = (blend) => blend === 'normal'
            ? pipeline
            : markPipeline(ctx, device, `${drawName} ${blend}`, 'SolidFill', vertexManager, undefined, blend);
        const gradientPipeline = markPipeline(ctx, device, `${drawName}Gradient`, 'GradientFill', vertexManager);
        // a gradient fill under a blend needs its own pipeline too
        const gradientPipelineFor = (blend) => blend === 'normal'
            ? gradientPipeline
            : markPipeline(ctx, device, `${drawName}Gradient ${blend}`, 'GradientFill', vertexManager, undefined, blend);
        return { device, bufferManager, vertexManager, pipeline, pipelineFor, gradientPipelineFor };
    });
}
function draw(device, ctx, scene, vb) {
    const items = scene.items;
    if (!items?.length) {
        return;
    }
    const res = getResources(device, ctx, vb);
    // A trail mark renders all its items as one ribbon.
    const item = items[0];
    const pipeline = res.pipelineFor(blendKey(item.blend));
    const bounds = scene.bounds ?? item.bounds;
    const gradient = isGradient(item.fill) && bounds ? item.fill : null;
    const fill = gradient
        ? whiteCarrier(item.opacity, item.fillOpacity)
        : Color.from2(item.fill, item.opacity, item.fillOpacity);
    const strokeGradient = isGradient(item.stroke) && bounds ? item.stroke : null;
    const stroke = strokeGradient
        ? whiteCarrier(item.opacity, item.strokeOpacity)
        : Color.from2(item.stroke, item.opacity, item.strokeOpacity);
    const shapeGeom = trail$1(ctx, items);
    const geometry = geometryForItem(ctx, item, shapeGeom, true);
    const [fillData, strokeData] = geometryVertexData(geometry, fill, stroke);
    const uniformBuffer = res.bufferManager.createUniformBuffer();
    const clip = markClip(ctx, scene);
    const vertexLength = res.vertexManager.getVertexLength();
    const gradientTarget = {
        ctx,
        device,
        name: `${drawName}Gradient`,
        pipelineFor: res.gradientPipelineFor,
        bufferManager: res.bufferManager,
        uniformBuffer,
        vertexLength,
        clip,
    };
    if (fillData.length > 0) {
        if (gradient && bounds) {
            enqueueGradient(gradientTarget, fillData, gradient, bounds, blendKey(item.blend));
        }
        else {
            ctx._renderQueue.enqueue({
                pipeline,
                drawCounts: [fillData.length / vertexLength],
                vertexBuffers: [res.bufferManager.createGeometryBuffer(fillData)],
                bindGroups: [createUniformBindGroup(drawName, device, pipeline, uniformBuffer)],
                clip,
            });
        }
    }
    if (strokeData.length > 0) {
        if (strokeGradient && bounds) {
            enqueueGradient(gradientTarget, strokeData, strokeGradient, bounds, blendKey(item.blend));
        }
        else {
            ctx._renderQueue.enqueue({
                pipeline,
                drawCounts: [strokeData.length / vertexLength],
                vertexBuffers: [res.bufferManager.createGeometryBuffer(strokeData)],
                bindGroups: [createUniformBindGroup(drawName, device, pipeline, uniformBuffer)],
                clip,
            });
        }
    }
}
var trail = {
    type: 'trail',
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
                drawCounts: [info.vertexCount ?? 6, instanceCount],
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
    submit(device, renderPassDescriptor, attachmentSize, timer) {
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
        timer?.resolve(commandEncoder);
        device.queue.submit([commandEncoder.finish()]);
        timer?.sample();
        this.queue = [];
    }
}
/**
 * Instances may only share a draw when the pipeline, the scissor rect and the
 * bind groups all match. Matching on the pipeline alone merged marks from
 * differently clipped groups into one draw carrying the first mark's clip.
 */
function sameBatchTarget(a, b) {
    if (a.pipeline !== b.pipeline ||
        a.geometryBuffer !== b.geometryBuffer ||
        a.geometryCount !== b.geometryCount ||
        a.vertexCount !== b.vertexCount) {
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
    context._clip = undefined;
    return canvas;
}

const viewBounds = (origin, width, height) => new Bounds().set(0, 0, width, height).translate(-origin[0], -origin[1]);
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
class WebGPURenderer extends Renderer {
    wgOptions = {
        debugLog: false,
        cacheShapes: true,
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
    _msaaTexture = null;
    _msaaTextureDevice = null;
    _offscreenTexture = null;
    _offscreenTextureDevice = null;
    _queue = new RenderQueue();
    _uniforms = { resolution: [0, 0], origin: [0, 0], dpi: 1 };
    _renderCount = 0;
    _warnedTextureSize = false;
    /** Reason the GPU device was lost, if it ever was. Set for every reason. */
    deviceLostReason = null;
    /** Set to an object to accumulate per-mark draw time. Diagnostic only. */
    markTimings = null;
    /** Number of GPU devices this renderer has created. */
    deviceGeneration = 0;
    _recoveries = 0;
    _pendingDestroy = [];
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
            domClear(el, 0);
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
        ctx._pipelineCache = {};
        ctx._markCache = {};
        ctx._pathCache = {};
        ctx._pathCacheSize = 0;
        ctx._geometryCache = {};
        ctx._geometryCacheSize = 0;
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
        const onChange = () => {
            if (this._finalized) {
                return;
            }
            this.resize(this._width, this._height, this._origin);
            this.frame();
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
     * buffers all belong to a device, so none of them outlive it.
     */
    _dropDevice() {
        this._device = null;
        this._gpuTimer = null;
        this._msaaTexture = null;
        this._msaaTextureDevice = null;
        this._offscreenTexture = null;
        this._offscreenTextureDevice = null;
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
    /**
     * Releases the GPU device and everything built on it.
     *
     * vega's own View.finalize does not reach the renderer, so a page that
     * creates and discards views leaks a device each time. Nothing recreates one
     * after this, so call it when the view is going away for good.
     */
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
    /** Resolves once the GPU has finished everything submitted so far. */
    async idle() {
        if (!this._device) {
            return;
        }
        // A lost device rejects this. Loss is handled by _handleDeviceLoss and the
        // pixel output is the real check, so do not fail over it.
        await this._device.queue.onSubmittedWorkDone().catch((err) => {
            if (this.wgOptions.debugLog === true) {
                console.warn('[vega-webgpu] onSubmittedWorkDone rejected:', err);
            }
        });
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
    async _frame(scene, markTypes, settle) {
        const tFrameStart = performance.now();
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
        this._settling = settle === true;
        try {
            this.draw(device, ctx, scene, vb, markTypes);
        }
        finally {
            this._settling = false;
        }
        const t2 = performance.now();
        // One pass for the whole frame: clears to the background color, draws
        // in scenegraph order, and resolves the MSAA attachment once.
        const renderPassDescriptor = createRenderPassDescriptor('Frame', this.clearColor());
        if (this._gpuTimer) {
            renderPassDescriptor.timestampWrites = this._gpuTimer.timestampWrites();
        }
        const target = this.wgOptions.offscreen ? this.offscreenTexture(device) : ctx.getCurrentTexture();
        if (ctx._sampleCount > 1) {
            renderPassDescriptor.colorAttachments[0].view = this.msaaTexture(device).createView();
            renderPassDescriptor.colorAttachments[0].resolveTarget = target.createView();
        }
        else {
            renderPassDescriptor.colorAttachments[0].view = target.createView();
        }
        const tSubmit = performance.now();
        this._queue.submit(device, renderPassDescriptor, [this._canvas?.width ?? 0, this._canvas?.height ?? 0], this._gpuTimer);
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
     * Releases the render lock and flushes a coalesced request, if any.
     *
     * Every exit from a frame (completion, early return, or failure) must come
     * through here, or `_isRendering` stays stuck and awaiting callers never wake.
     */
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
            this._render(this._lastRender.scene, this._lastRender.markTypes, true);
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
     * Queues a GPU resource for destruction once the current frame is submitted.
     * Safe to call from inside a mark's draw, where the resource may still be
     * referenced by a queued but not yet encoded draw.
     */
    deferDestroy(resource) {
        this._pendingDestroy.push(resource);
    }
    _finishFrame() {
        this._isRendering = false;
        // The frame is submitted, so the buffers its draws used can go. An
        // implementation keeps a destroyed buffer alive until the commands
        // referencing it have run.
        if (this._device) {
            bufferPool(this._device).release();
        }
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
            this._render(pending.scene, pending.markTypes, pending.settle);
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
            if (this._lastRender) {
                this._render(this._lastRender.scene, this._lastRender.markTypes, true);
            }
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
        if (this.markTimings) {
            const t0 = performance.now();
            mark.draw.call(this, device, ctx, scene, bounds, markTypes);
            const key = scene.marktype;
            this.markTimings[key] = (this.markTimings[key] ?? 0) + (performance.now() - t0);
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
        const existing = this._offscreenTexture;
        if (existing &&
            this._offscreenTextureDevice === device &&
            existing.width === canvas.width &&
            existing.height === canvas.height) {
            return existing;
        }
        existing?.destroy();
        this._offscreenTexture = device.createTexture({
            label: 'Offscreen Color Texture',
            size: [canvas.width, canvas.height, 1],
            format: preferredColorFormat(),
            dimension: '2d',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        });
        this._offscreenTextureDevice = device;
        return this._offscreenTexture;
    }
    clearColor() {
        const bg = this._bgcolor ? Color.from(this._bgcolor) : null;
        if (!bg) {
            // canvas clears to transparent and only fills when a background is set
            return { r: 0.0, g: 0.0, b: 0.0, a: 0.0 };
        }
        // The surface is configured alphaMode premultiplied, so a translucent
        // background has to be premultiplied here too or it composites too bright.
        return { r: bg.r * bg.a, g: bg.g * bg.a, b: bg.b * bg.a, a: bg.a };
    }
}

const webgpuSupported = typeof navigator !== 'undefined' && !!navigator.gpu;
if (webgpuSupported) {
    // The WebGPU canvas cannot hand out a 2D context for picking; route the
    // handler to the renderer's detached pick canvas instead.
    CanvasHandler.prototype.context = function () {
        return this._canvas.getContext('2d') || (this._canvas._pickCanvas?.getContext('2d') ?? null);
    };
}
else {
    console.warn('[vega-webgpu] WebGPU is not supported in this environment; ' +
        "the 'webgpu' renderer will fall back to canvas rendering.");
}
renderModule('webgpu', {
    renderer: webgpuSupported ? WebGPURenderer : CanvasRenderer,
    handler: CanvasHandler,
});

export { WebGPURenderer };
//# sourceMappingURL=vega-webgpu-renderer.module.js.map
