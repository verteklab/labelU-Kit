import cloneDeep from 'lodash.clonedeep';

import type { BasicToolParams } from './Tool';
import { Tool } from './Tool';
import type { AxisPoint } from '../shapes';
import { axis, eventEmitter } from '../singletons';
import { ToolWrapper } from './Tool.decorator';

export interface DragToolOptions extends BasicToolParams<any, any> {
  /**
   * 是否允许拖动
   * @default true
   */
  enabled?: boolean;
}

@ToolWrapper
export class DragTool extends Tool<any, any, DragToolOptions> {
  private _isDragging = false;
  private _draggedAnnotation: any = null;
  private _startPoint: AxisPoint | null = null;
  private _originalData: any = null;
  private _dragOffset: AxisPoint = { x: 0, y: 0 };

  static create({ data, ...config }: DragToolOptions) {
    return new DragTool({ ...config, data: data ?? [] });
  }

  constructor(params: DragToolOptions) {
    super({
      name: 'drag',
      enabled: true,
      labels: [],
      data: [],
      ...params,
    });

    // 拖动工具需要 labelMapping 属性
    this.labelMapping = new Map();

    // 拖动工具需要一个默认标签来通过装饰器的检查
    this.activeLabel = 'drag';

    // 添加一个虚拟标签到 labelMapping
    this.labelMapping.set('drag', {
      id: 'drag',
      value: 'drag',
      key: '拖动工具',
      color: '#666',
    } as any);

    // 手动绑定全局 mouseup 事件，因为 @ToolWrapper 没有绑定
    document.addEventListener('mouseup', this._handleGlobalMouseUp);
  }

  /**
   * 检查是否可以拖动标注
   */
  private _canDragAnnotation(e: MouseEvent): any {
    const point = { x: e.offsetX, y: e.offsetY };

    // 获取所有工具
    const tools = this.getTools();

    // 遍历所有工具，查找鼠标下的标注
    for (const [, tool] of tools.entries()) {
      if (tool.name === 'drag') continue;

      if (tool.drawing && tool.drawing.size > 0) {
        for (const annotation of tool.drawing.values()) {
          if (annotation.group && typeof annotation.group.isShapesUnderCursor === 'function') {
            try {
              const isUnder = annotation.group.isShapesUnderCursor(point);
              if (isUnder) {
                return annotation;
              }
            } catch (error) {
              // 静默处理错误
            }
          }
        }
      }

      if (tool.draft && typeof tool.draft.isUnderCursor === 'function') {
        try {
          const isUnder = tool.draft.isUnderCursor(point);
          if (isUnder) {
            return tool.draft;
          }
        } catch (error) {
          // 静默处理错误
        }
      }
    }

    return null;
  }

  /**
   * 开始拖动
   */
  private _startDrag(e: MouseEvent, annotation: any) {
    this._isDragging = true;
    this._draggedAnnotation = annotation;
    this._startPoint = axis!.getOriginalCoord({ x: e.offsetX, y: e.offsetY });
    this._dragOffset = { x: 0, y: 0 };

    // 保存原始数据
    this._originalData = cloneDeep(annotation.data);

    // 发出拖动开始事件
    eventEmitter.emit('move', { annotation, event: e });

    // 设置鼠标样式
    document.body.style.cursor = 'grabbing';
  }

  /**
   * 拖动中
   */
  private _onDrag(e: MouseEvent) {
    if (!this._isDragging || !this._draggedAnnotation || !this._startPoint) {
      return;
    }

    const currentPoint = axis!.getOriginalCoord({ x: e.offsetX, y: e.offsetY });
    const deltaX = currentPoint.x - this._startPoint.x;
    const deltaY = currentPoint.y - this._startPoint.y;

    // 计算新的偏移量
    const newOffsetX = deltaX - this._dragOffset.x;
    const newOffsetY = deltaY - this._dragOffset.y;

    // 只有当位移足够大时才更新，避免微小移动导致的频繁更新
    if (Math.abs(newOffsetX) < 0.5 && Math.abs(newOffsetY) < 0.5) {
      return;
    }

    // 更新标注坐标
    this._updateAnnotationPosition(this._draggedAnnotation, newOffsetX, newOffsetY);

    // 更新偏移量
    this._dragOffset.x = deltaX;
    this._dragOffset.y = deltaY;

    // 发出拖动中事件
    eventEmitter.emit('move', {
      annotation: this._draggedAnnotation,
      deltaX: newOffsetX,
      deltaY: newOffsetY,
      event: e,
    });

    // 重新渲染
    axis?.rerender();
  }

  /**
   * 结束拖动
   */
  private _endDrag(e: MouseEvent) {
    if (!this._isDragging || !this._draggedAnnotation) {
      return;
    }

    // 发出拖动结束事件
    eventEmitter.emit('move', {
      annotation: this._draggedAnnotation,
      originalData: this._originalData,
      event: e,
    });

    // 触发标注变更事件
    eventEmitter.emit('change', [this._draggedAnnotation.data], e);

    // 立即重置状态，防止后续 mousemove 事件继续处理
    this._isDragging = false;
    this._draggedAnnotation = null;
    this._startPoint = null;
    this._originalData = null;
    this._dragOffset = { x: 0, y: 0 };

    // 恢复鼠标样式
    document.body.style.cursor = 'move'; // 保持拖动工具激活状态的光标
  }

  /**
   * 更新标注位置
   */
  private _updateAnnotationPosition(annotation: any, deltaX: number, deltaY: number) {
    // 首先更新标注数据
    this._updateAnnotationData(annotation, deltaX, deltaY);

    // 对于立方体注解，我们只更新数据，让注解自己处理坐标同步
    // 这样可以避免双重更新导致的形变问题
    if (annotation.name === 'cuboid') {
      // 立方体注解没有响应数据变化的机制，我们需要强制重新构建图形
      // 但这次要确保清理旧的图形和标签，避免拖影
      if (annotation.group && typeof annotation.group.clear === 'function') {
        annotation.group.clear();
      }

      // 清理旧的标签，避免拖影
      if (annotation.doms && Array.isArray(annotation.doms)) {
        annotation.doms.forEach((dom: any) => {
          if (dom && typeof dom.destroy === 'function') {
            dom.destroy();
          }
        });
        annotation.doms = [];
      }

      // 重新构建图形，基于新的 data
      if (annotation._setupShapes && typeof annotation._setupShapes === 'function') {
        annotation._setupShapes();
      }

      // 触发重新渲染
      if (axis) {
        requestAnimationFrame(() => {
          if (axis) {
            axis.rerender();
          }
        });
      }
      return;
    }

    // 对于其他类型的注解，仍然使用原有的逻辑
    // 更新每个形状的坐标
    annotation.group.each((shape: any) => {
      // 更新坐标
      shape.coordinate = shape.coordinate.map((p: any) => ({
        x: p.x + deltaX,
        y: p.y + deltaY,
      }));

      // 更新形状
      shape.update();
    });

    // 更新组
    annotation.group.update();

    // 重新渲染
    if (axis) {
      requestAnimationFrame(() => {
        if (axis) {
          axis.rerender();
        }
      });
    }
  }

  /**
   * 更新标注数据
   */
  private _updateAnnotationData(annotation: any, deltaX: number, deltaY: number) {
    const { data } = annotation;

    // 根据标注类型更新相应的数据
    switch (annotation.name) {
      case 'rect':
        data.x += deltaX;
        data.y += deltaY;
        break;
      case 'point':
        data.x += deltaX;
        data.y += deltaY;
        break;
      case 'polygon':
        if (data.points && Array.isArray(data.points)) {
          data.points.forEach((point: AxisPoint) => {
            point.x += deltaX;
            point.y += deltaY;
          });
        }
        break;
      case 'line':
        if (data.points && Array.isArray(data.points)) {
          data.points.forEach((point: AxisPoint) => {
            point.x += deltaX;
            point.y += deltaY;
          });
        }
        break;
      case 'cuboid':
        if (data.front) {
          data.front.tl.x += deltaX;
          data.front.tl.y += deltaY;
          data.front.tr.x += deltaX;
          data.front.tr.y += deltaY;
          data.front.br.x += deltaX;
          data.front.br.y += deltaY;
          data.front.bl.x += deltaX;
          data.front.bl.y += deltaY;
        }
        if (data.back) {
          data.back.tl.x += deltaX;
          data.back.tl.y += deltaY;
          data.back.tr.x += deltaX;
          data.back.tr.y += deltaY;
          data.back.br.x += deltaX;
          data.back.br.y += deltaY;
          data.back.bl.x += deltaX;
          data.back.bl.y += deltaY;
        }
        break;
    }
  }

  /**
   * 鼠标按下事件处理
   */
  protected handleMouseDown = (e: MouseEvent) => {
    if (!this.config?.enabled) {
      return;
    }

    // 检查是否在标注上
    const annotation = this._canDragAnnotation(e);
    if (annotation) {
      this._startDrag(e, annotation);
    }
  };

  /**
   * 鼠标移动事件处理
   */
  protected handleMouseMove = (e: MouseEvent) => {
    // 严格检查拖动状态，确保所有必要条件都满足
    if (this._isDragging && this._draggedAnnotation && this._startPoint) {
      this._onDrag(e);
    }
  };

  /**
   * 鼠标释放事件处理
   */
  protected handleMouseUp = (e: MouseEvent) => {
    if (this._isDragging) {
      this._endDrag(e);
    }
  };

  /**
   * ESC键取消拖动
   */
  protected handleEscape = () => {
    if (this._isDragging) {
      this._endDrag(new MouseEvent('mouseup'));
    }
  };

  /**
   * 激活拖动工具
   */
  public activate(label?: string) {
    super.activate(label);
    // 拖动工具不需要标签

    // 改变光标为移动样式 - 通过 document.body.style.cursor
    document.body.style.cursor = 'move';
  }

  /**
   * 停用拖动工具
   */
  public deactivate() {
    super.deactivate();
    // 确保拖动状态被重置
    if (this._isDragging) {
      this._endDrag(new MouseEvent('mouseup'));
    }

    // 恢复默认光标
    document.body.style.cursor = 'default';
  }

  /**
   * 全局鼠标释放事件处理器
   * 因为 @ToolWrapper 没有绑定 mouseup 事件，所以需要手动绑定
   */
  private _handleGlobalMouseUp = (e: MouseEvent) => {
    // 只处理在拖动工具激活状态下的 mouseup 事件
    if (this._isDragging) {
      this._endDrag(e);
    }
  };

  /**
   * 渲染方法
   */
  public render(_ctx: CanvasRenderingContext2D) {
    // 拖动工具不需要渲染任何内容
    // 它只是用来处理拖动逻辑
  }

  /**
   * 销毁方法
   */
  public destroy() {
    // 移除事件监听器
    document.removeEventListener('mouseup', this._handleGlobalMouseUp);
  }
}
