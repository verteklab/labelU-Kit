import EventEmitter from 'eventemitter3';
import Color from 'color';

import { cursorManager } from '@/singletons/cursorManager';
import type { RectToolOptions } from '@/tools/Rect.tool';
import type { LineToolOptions } from '@/tools/Line.tool';
import type { CuboidToolOptions } from '@/tools/Cuboid.tool';
import type { PolygonToolOptions } from '@/tools/Polygon.tool';
import type { PointToolOptions } from '@/tools/Point.tool';
import type { AllShape } from '@/shapes/types';

import { axis, eventEmitter } from '../singletons';
import { EInternalEvent } from '../enums';
import { Annotation, type AnnotationParams } from '../annotations/Annotation';
import type { BasicImageAnnotation, EditType, ToolName } from '../interface';
import type { AxisPoint } from '../shapes';
import { Point, Group, Spline, ClosedSpline } from '../shapes';
import { ControllerPoint } from './ControllerPoint';
import { ControllerEdge } from './ControllerEdge';
import { LabelBase } from '../annotations/Label.base';

type MouseEventHandler = (e: MouseEvent) => void;

export class Draft<Data extends BasicImageAnnotation, Style extends Record<string, any>> extends EventEmitter {
  public isPicked = false;

  public config: RectToolOptions | LineToolOptions | CuboidToolOptions | PolygonToolOptions | PointToolOptions | null =
    null;

  public labelColor = LabelBase.DEFAULT_COLOR;

  public strokeColor = LabelBase.DEFAULT_COLOR;

  public name: ToolName;

  public id: string;

  public data: Data;

  public style: Style;

  public group: Group<AllShape>;

  public hoveredStyle?: Style | ((style: Style) => Style);

  public showOrder: boolean = false;

  private _onMoveHandlers: MouseEventHandler[] = [];

  public movable: boolean = true;

  private _onMouseDownHandlers: MouseEventHandler[] = [];

  private _onMouseUpHandlers: MouseEventHandler[] = [];

  private _serializeData: {
    id: string;
    order: number;
    shapes: {
      id: string;
    }[];
  } | null = null;

  constructor({
    id,
    data,
    style,
    hoveredStyle,
    showOrder,
    name,
    labelColor,
    movable = true,
  }: AnnotationParams<Data, Style> & { name: ToolName; labelColor: string; movable?: boolean }) {
    super();

    this.name = name;
    this.id = id;
    this.data = data;
    this.style = style;
    this.hoveredStyle = hoveredStyle;
    this.showOrder = showOrder;
    this.labelColor = labelColor;
    this.movable = movable;

    this.strokeColor = Color(this.labelColor).alpha(Annotation.strokeOpacity).string();
    // 光标颜色切换
    if (cursorManager?.cursor) {
      cursorManager.color = this.labelColor;
    }

    this.group = new Group(id, data.order, true);

    // 应该让草稿内的图形对象先于草稿对象监听鼠标事件
    // TODO：模仿DOM的事件设计冒泡机制，处理重叠的图形鼠标事件
    this.on('setup', () => {
      eventEmitter.on(EInternalEvent.LeftMouseDown, this._handleMouseDown);
      eventEmitter.on(EInternalEvent.MouseMove, this._handleMouseMove);
      eventEmitter.on(EInternalEvent.LeftMouseUp, this._handleLeftMouseUp);
      eventEmitter.on(EInternalEvent.RightMouseUp, this._handleRightMouseUp);
    });
  }

  protected requestEdit(type: EditType): boolean {
    const { config } = this;

    return (
      config?.requestEdit?.(type, {
        toolName: this.name,
        label: this.data.label,
      }) ?? true
    );
  }

  private _handleMouseDown = (e: MouseEvent) => {
    // data不存在说明当前的草稿被销毁，在创建点之后，不取消选中立即再创建新的点，此时事件还没来得及销毁
    if (!this.data) {
      return;
    }

    // 如果鼠标落在控制点或者控制边上，不选中草稿
    if (this._isControlUnderCursor({ x: e.offsetX, y: e.offsetY }) || !this.requestEdit('update')) {
      return;
    }

    // 存在草稿说明当前处于编辑状态，只需要判断鼠标是否落在在草稿上即可
    if (this.isUnderCursor({ x: e.offsetX, y: e.offsetY })) {
      this.isPicked = true;
      this._serializeData = this.group.serialize();
      cursorManager?.invokeCursor('move');
      axis?.rerender();

      for (const handler of this._onMouseDownHandlers) {
        handler(e);
      }
    }
  };

  private _isControlUnderCursor(mouseCoord: AxisPoint) {
    const controls = this._getControls();

    for (const control of controls) {
      if (control.isUnderCursor(mouseCoord)) {
        return true;
      }
    }

    return false;
  }

  private _getControls() {
    const controls: (ControllerPoint | ControllerEdge)[] = [];

    const digDeep = (group: Group) => {
      for (const shape of group.shapes) {
        if (shape instanceof Group) {
          digDeep(shape as Group);
        } else if (shape instanceof ControllerPoint || shape instanceof ControllerEdge) {
          controls.push(shape);
        }
      }
    };

    digDeep(this.group);

    return controls;
  }

  private _handleMouseMove = (e: MouseEvent) => {
    const { _onMoveHandlers, isPicked, movable } = this;

    if (!isPicked || !movable) {
      return;
    }

    // 统一在这里移动草稿
    this.moveByDistance();

    eventEmitter.emit(EInternalEvent.DraftMove, e, this);

    for (const handler of _onMoveHandlers) {
      handler(e);
    }
  };

  private _handleRightMouseUp = (e: MouseEvent) => {
    const isUnderCursor = this.isUnderCursor({ x: e.offsetX, y: e.offsetY });

    /**
     * 因为清除isMoved是异步的
     * see https://github.com/opendatalab/labelU-Kit/blob/main/packages/image/src/core/Axis.ts#L230
     */
    if (!isUnderCursor && !axis?.isMoved) {
      this.group.emit(EInternalEvent.UnSelect, e, this);
    }
  };

  private _handleLeftMouseUp = (e: MouseEvent) => {
    const { isPicked } = this;

    if (!isPicked) {
      return;
    }

    this.isPicked = false;
    this._serializeData = null;

    for (const handler of this._onMouseUpHandlers) {
      handler(e);
    }

    eventEmitter.emit('change');
  };

  private _digCoordinates(): AxisPoint[] | AxisPoint[][] {
    const loop = (shape: any): AxisPoint | AxisPoint[] => {
      if (shape.shapes) {
        return (shape as Group).shapes.map(loop) as AxisPoint[];
      } else {
        return shape.dynamicCoordinate;
      }
    };

    return (this._serializeData?.shapes?.map(loop) as AxisPoint[] | AxisPoint[][]) ?? [];
  }

  /**
   * 收集序列化快照中所有动态坐标点（用于整体平移时的边界钳制）
   */
  private _collectSerializedDynamicPoints(node: any): AxisPoint[] {
    if (!node) {
      return [];
    }

    if (Array.isArray(node.shapes)) {
      let acc: AxisPoint[] = [];

      for (let i = 0; i < node.shapes.length; i++) {
        acc = acc.concat(this._collectSerializedDynamicPoints(node.shapes[i]));
      }

      return acc;
    }

    const points: AxisPoint[] = [];

    if (node.dynamicCoordinate) {
      points.push(...node.dynamicCoordinate);
    }

    if (node.dynamicControlPoints) {
      points.push(...node.dynamicControlPoints);
    }

    return points;
  }

  /**
   * 将整体平移增量钳制到安全区内，使所有点可同时贴边（避免 isCoordinatesSafe 整轴丢弃移动）
   */
  private _clampTranslationDelta(dx: number, dy: number, dynamicPoints: AxisPoint[]) {
    if (!axis || dynamicPoints.length === 0) {
      return { dx, dy };
    }

    const { minX, maxX, minY, maxY } = axis.safeZone;
    let dxMin = -Infinity;
    let dxMax = Infinity;
    let dyMin = -Infinity;
    let dyMax = Infinity;

    for (let i = 0; i < dynamicPoints.length; i++) {
      const p = dynamicPoints[i];

      dxMin = Math.max(dxMin, minX - p.x);
      dxMax = Math.min(dxMax, maxX - p.x);
      dyMin = Math.max(dyMin, minY - p.y);
      dyMax = Math.min(dyMax, maxY - p.y);
    }

    const clampedDx = dxMin > dxMax ? 0 : Math.min(Math.max(dx, dxMin), dxMax);
    const clampedDy = dyMin > dyMax ? 0 : Math.min(Math.max(dy, dyMin), dyMax);

    return { dx: clampedDx, dy: clampedDy };
  }

  public finishSetup() {
    this.emit('setup');
  }

  public getCenter() {
    console.warn('getCenter is not implemented');
    return { x: 0, y: 0 };
  }

  public onMove(handler: MouseEventHandler) {
    this._onMoveHandlers.push(handler);
  }

  public onMouseDown(handler: MouseEventHandler) {
    this._onMouseDownHandlers.push(handler);
  }

  public onMouseUp(handler: MouseEventHandler) {
    this._onMouseUpHandlers.push(handler);
  }

  /**
   * 获取组合除去控制点的包围盒
   *
   * @description 对于一些特殊的图形，比如圆，创建选框时在组内需要忽略半径
   */
  public getBBoxWithoutControllerPoint() {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < this.group.shapes.length; i += 1) {
      const shape = this.group.shapes[i];

      if (shape instanceof Point) {
        continue;
      }

      minX = Math.min(minX, shape.bbox.minX);
      minY = Math.min(minY, shape.bbox.minY);
      maxX = Math.max(maxX, shape.bbox.maxX);
      maxY = Math.max(maxY, shape.bbox.maxY);
    }

    return {
      minX,
      minY,
      maxX,
      maxY,
    };
  }

  public isUnderCursor(mouseCoord: AxisPoint) {
    // 线条 和 立体框 应该判定bbox在鼠标下
    if (this.name === 'line' || this.name === 'cuboid') {
      const bbox = this.getBBoxWithoutControllerPoint();

      return (
        mouseCoord.x >= bbox.minX && mouseCoord.x <= bbox.maxX && mouseCoord.y >= bbox.minY && mouseCoord.y <= bbox.maxY
      );
    }

    return Boolean(this.group.isShapesUnderCursor(mouseCoord));
  }

  /**
   * 根据鼠标移动的距离移动草稿
   */
  public moveByDistance() {
    const { config, _serializeData } = this;

    let distX = axis!.distance.x;
    let distY = axis!.distance.y;

    if (!config?.outOfImage && _serializeData) {
      const dynamicPoints = this._collectSerializedDynamicPoints(_serializeData);
      const clamped = this._clampTranslationDelta(distX, distY, dynamicPoints);

      distX = clamped.dx;
      distY = clamped.dy;
    }

    // TODO: 消灭any
    const loop = (shape: AllShape, index: number, serialized: any) => {
      if (shape instanceof Group) {
        (shape as Group).each((item, idx) => {
          loop(item, idx, serialized[index].shapes);
        });
      } else {
        shape.plainCoordinate.forEach((point, i) => {
          shape.coordinate[i].x = axis!.getOriginalX(serialized[index].dynamicCoordinate[i].x + distX);
          shape.coordinate[i].y = axis!.getOriginalY(serialized[index].dynamicCoordinate[i].y + distY);
        });

        if (shape instanceof Spline || shape instanceof ClosedSpline) {
          shape.plainControlPoints.forEach((point, i) => {
            shape.controlPoints[i].x = axis!.getOriginalX(serialized[index].dynamicControlPoints[i].x + distX);
            shape.controlPoints[i].y = axis!.getOriginalY(serialized[index].dynamicControlPoints[i].y + distY);
          });
        }
      }
    };

    // 更新草稿坐标
    this.group.each((shape, index) => {
      loop(shape, index, _serializeData?.shapes);
    });

    // 手动更新组合的包围盒
    this.group.update();
  }

  public render(ctx: CanvasRenderingContext2D) {
    // 选中的标注需要在最上层
    this.group.render(ctx);
  }

  public clearHandlers() {
    this._onMoveHandlers = [];
    this._onMouseDownHandlers = [];
    this._onMouseUpHandlers = [];
  }

  public get bbox() {
    return this.group.bbox;
  }

  public destroy() {
    this.data = null as any;
    this.group.destroy();
    this.clearHandlers();
    axis?.resetOffset();
    this.removeAllListeners();
    eventEmitter.off(EInternalEvent.LeftMouseDown, this._handleMouseDown);
    eventEmitter.off(EInternalEvent.MouseMove, this._handleMouseMove);
    eventEmitter.off(EInternalEvent.LeftMouseUp, this._handleLeftMouseUp);
    eventEmitter.off(EInternalEvent.RightMouseUp, this._handleRightMouseUp);
  }
}
