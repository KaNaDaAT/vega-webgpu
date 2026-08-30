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
const trailShape = pathTrail().x(x).y(y).defined(def).size(wh);
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
            .curve(pathCurves(interp, item.orient, item.tension))
            .context(null)(items);
    return geometryForPath(context, path ?? '', 0.1);
}
/**
 * Path geometry for a line mark, honouring `interpolate`, `tension` and the
 * `defined` gaps. Used when the line is not a plain polyline.
 */
function line$1(context, items) {
    const item = items[0];
    const curve = pathCurves(item.interpolate || 'linear', item.orient, item.tension);
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
    const type = pathSymbols(shapeName || 'circle');
    const path = Symbol$1(type, size).context(null)() ?? '';
    return geometryForPath(context, path, 0.1);
}

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
const textMark = Marks.text;
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
    const b = textMark.bound(new Bounds(), clone, 0);
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

const viewBounds = (origin, width, height) => new Bounds().set(0, 0, width, height).translate(-origin[0], -origin[1]);
class WebGPURenderer extends Renderer {
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
