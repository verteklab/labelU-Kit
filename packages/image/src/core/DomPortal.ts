/**
 * 在画布容器上挂载一块绝对定位的 DOM（标签、气泡等），坐标随图形与视口变换同步更新。
 * 通过 AxisChange / MouseMove（平移时）重算 transform，使浮层与标注形状对齐。
 */
import { EInternalEvent } from '../enums';
import { axis, eventEmitter } from '../singletons';
import type { AllShape } from '../shapes/types';

/** 浮层在轴坐标系中的位置，可选旋转（度） */
interface DomPortalPosition {
  x: number;
  y: number;
  rotate?: number;
}

export interface DomPortalParams {
  /** 初始旋转角度（度），可被 getPosition 返回值覆盖 */
  rotate?: number;
  /** 对应 CSS z-index，越大越靠前 */
  order?: number;
  /** 自定义浮层锚点；缺省时取图形 dynamicCoordinate[0] */
  getPosition?: (shape: AllShape, wrapper: HTMLElement) => DomPortalPosition;
  /** HTML 字符串或已有 DOM 节点 */
  content: HTMLElement | string;
  /** 绑定的图形，用于默认定位与生命周期关联 */
  bindShape: AllShape;
  /** 为 true 时浮层不接收指针事件（事件穿透到画布） */
  preventPointerEvents?: boolean;
  /** 追加到 wrapper 上的内联样式 */
  style?: Record<string, string>;
}

export class DomPortal {
  public x: number = 0;

  public y: number = 0;

  public order: number = 2;

  /** HTML 字符串或 DOM 节点 */
  private _content: string | HTMLElement | null = null;

  private _rotate: number = 0;

  private _preventPointerEvents: boolean = false;

  /** 画布父节点，作为浮层定位上下文 */
  private _container: HTMLElement = axis!.renderer!.canvas.parentElement!;

  /** 实际挂载 content 的包裹层，由 transform 做平移/旋转 */
  private _wrapper: HTMLElement = document.createElement('div');

  private _shape: AllShape;

  /** 计算当前轴坐标与旋转，并同步 this.x / this.y */
  private _getPosition: () => DomPortalPosition;

  constructor({
    content,
    bindShape,
    preventPointerEvents = false,
    order = 2,
    rotate = 0,
    getPosition,
    style,
  }: DomPortalParams) {
    this._content = content;
    this._shape = bindShape;
    this._preventPointerEvents = preventPointerEvents;
    this.order = order;
    this._rotate = rotate;
    this._getPosition = () => {
      let position: DomPortalPosition = {
        x: 0,
        y: 0,
      };

      if (typeof getPosition === 'function') {
        position = getPosition(this._shape, this._wrapper);
      } else {
        // 默认锚在图形第一个动态坐标点
        position = {
          x: this._shape.dynamicCoordinate[0].x,
          y: this._shape.dynamicCoordinate[0].y,
        };
      }

      this.x = position.x;
      this.y = position.y;

      if (position.rotate) {
        this._rotate = position.rotate;
      }

      return position;
    };

    if (bindShape) {
      // 缩放/坐标系变化时重算位置；画布平移时通过 MouseMove + distance 更新
      eventEmitter.on(EInternalEvent.AxisChange, this._handleUpdatePosition);
      eventEmitter.on(EInternalEvent.MouseMove, this._handleUpdatePositionByMouse);
    }

    if (!content) {
      throw new Error('Element must be set');
    }

    if (this._container.contains(this._wrapper)) {
      console.warn('Container already contains the element');
    }

    if (typeof this._content === 'string') {
      this._wrapper.innerHTML = this._content;
    } else {
      this._wrapper.appendChild(this._content);
    }

    this._container.appendChild(this._wrapper);
    this._setupElementStyle();

    if (style) {
      Object.assign(this._wrapper.style, style);
    }
  }

  /** 初始化 wrapper 的定位方式并应用首次 transform */
  private _setupElementStyle() {
    const { _wrapper } = this;

    _wrapper.style.position = 'absolute';
    _wrapper.style.left = '0';
    _wrapper.style.top = '0';
    _wrapper.style.userSelect = 'none';
    _wrapper.style.display = 'block';
    _wrapper.style.transformOrigin = 'center center';
    _wrapper.style.zIndex = `${this.order}`;
    _wrapper.style.pointerEvents = this._preventPointerEvents ? 'none' : 'auto'; // 让鼠标穿透元素

    const position = this._getPosition();

    _wrapper.style.transform = `translate(${position.x}px, ${position.y}px) rotate(${this._rotate}deg)`;
  }

  private _handleUpdatePosition = () => {
    this._updatePosition();
  };

  /** 仅在画布发生平移（axis.distance 非零）时刷新，避免无谓更新 */
  private _handleUpdatePositionByMouse = () => {
    if (axis?.distance.x || axis?.distance.y) {
      this._updatePosition();
    }
  };

  private _updatePosition() {
    const { _wrapper } = this;

    const position = this._getPosition();

    _wrapper.style.transform = `translate(${position.x}px, ${position.y}px) rotate(${this._rotate}deg)`;
  }

  public set rotate(rotate: number) {
    this._rotate = rotate;
    this._wrapper.style.transform = `translate(${this.x}px, ${this.y}px) rotate(${rotate}deg)`;
  }

  public get rotate() {
    return this._rotate;
  }

  public show() {
    this._wrapper.style.display = 'block';
  }

  public hide() {
    this._wrapper.style.display = 'none';
  }

  /** 临时提到最前（例如弹层需要盖住其它浮层） */
  public toTop() {
    this._wrapper.style.zIndex = '1049';
  }

  /** 恢复为构造时的 order 对应 z-index */
  public resetZIndex() {
    this._wrapper.style.zIndex = `${this.order}`;
  }

  public destroy() {
    this._wrapper.remove();
    eventEmitter.off(EInternalEvent.AxisChange, this._handleUpdatePosition);
    eventEmitter.off(EInternalEvent.MouseMove, this._handleUpdatePositionByMouse);
  }
}
