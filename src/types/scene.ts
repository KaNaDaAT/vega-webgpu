import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaScene } from './context.js';

/**
 * Gradient descriptor as produced by vega scale/gradient encodings.
 * Coordinates are normalized to the item's bounding box.
 */
export interface SceneGradient {
  gradient: 'linear' | 'radial';
  id?: string;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  r1?: number;
  r2?: number;
  stops?: { offset: number; color: string }[];
}

/** Any color-like value found on scenegraph items. */
export type SceneColor = string | SceneGradient;

export interface StrokeStyle {
  stroke?: SceneColor;
  strokeWidth?: number;
  strokeOpacity?: number;
  strokeCap?: CanvasLineCap;
}

export interface FillStyle {
  fill?: SceneColor;
  fillOpacity?: number;
}

/**
 * A runtime scenegraph item: the property subset the renderer reads.
 * (vega-typings' scene types miss several runtime properties, so the
 * renderer maintains its own definitions.)
 */
export interface SceneItem {
  mark?: GPUVegaScene;
  bounds?: Bounds;
  datum?: { id?: string | number };
  x?: number;
  y?: number;
  opacity?: number;
  zindex?: number;
  /** Assigned during z-order sorting. */
  index?: number;
}

export type SceneRectExt = SceneItem &
  FillStyle &
  StrokeStyle & {
    width?: number;
    height?: number;
    cornerRadius?: number;
    cornerRadiusTopLeft?: number;
    cornerRadiusTopRight?: number;
    cornerRadiusBottomLeft?: number;
    cornerRadiusBottomRight?: number;
  };

export type SceneGroupExt = SceneRectExt & {
  clip?: boolean;
  items?: GPUVegaScene[];
};

export type SceneRule = SceneItem &
  StrokeStyle & {
    x2?: number;
    y2?: number;
  };

export type SceneLinePoint = SceneItem &
  StrokeStyle & {
    defined?: boolean;
    interpolate?: string;
    orient?: string;
    tension?: number;
  };

export type SceneSymbolExt = SceneItem &
  FillStyle &
  StrokeStyle & {
    size?: number;
    shape?: string;
    angle?: number;
  };

export type ScenePathItem = SceneItem &
  FillStyle &
  StrokeStyle & {
    path?: string;
  };

export type SceneShapeItem = SceneItem &
  FillStyle &
  StrokeStyle & {
    id?: string | number;
    shape?: unknown;
  };

export type SceneArcItem = SceneItem &
  FillStyle &
  StrokeStyle & {
    startAngle?: number;
    endAngle?: number;
    innerRadius?: number;
    outerRadius?: number;
    cornerRadius?: number;
    padAngle?: number;
  };

export type SceneAreaItem = SceneLinePoint &
  FillStyle & {
    width?: number;
    height?: number;
    size?: number;
  };

/**
 * A loaded image resource: an HTMLImageElement, HTMLCanvasElement (e.g.
 * from vega's heatmap transform), ImageBitmap, or the pending placeholder.
 */
export interface SceneImageSource {
  complete?: boolean;
  width: number;
  height: number;
  src?: string;
  url?: string;
  toDataURL?: () => string;
}

export type SceneImageItem = SceneItem & {
  url?: string;
  image?: SceneImageSource;
  width?: number;
  height?: number;
  aspect?: boolean;
  smooth?: boolean;
  align?: 'left' | 'center' | 'right';
  baseline?: 'top' | 'middle' | 'bottom';
};

export type SceneTextItem = SceneItem &
  FillStyle &
  StrokeStyle & {
    text?: string | string[];
    font?: string;
    fontSize?: number;
    fontStyle?: string;
    fontVariant?: string;
    fontWeight?: string | number;
    align?: 'left' | 'center' | 'right';
    baseline?: 'alphabetic' | 'top' | 'middle' | 'bottom' | 'line-top' | 'line-bottom';
    dx?: number;
    dy?: number;
    angle?: number;
    radius?: number;
    theta?: number;
    lineBreak?: string;
    lineHeight?: number;
    limit?: number;
    ellipsis?: string;
    dir?: 'ltr' | 'rtl';
  };
