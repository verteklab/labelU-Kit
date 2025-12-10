import { Renderer } from './core/Renderer';
import { CuboidTool, PointTool, RectTool } from './tools';
import { LineTool } from './tools/Line.tool';
import type { ImageOption } from './core/BackgroundRenderer';
import { BackgroundRenderer } from './core/BackgroundRenderer';
import type { Axis } from './core/Axis';
import type { AllTypeAnnotationDataGroup, AnnotationTool, AnnotationToolData, ToolName } from './interface';
import { EInternalEvent } from './enums';
import type { Monitor } from './core/Monitor';
import { createAxis } from './singletons/axis';
import { createMonitor, eventEmitter, rbush } from './singletons';
import { PolygonTool } from './tools/Polygon.tool';
import { Annotation } from './annotations';
import { TOOL_NAMES } from './constant';
import type { CursorManager } from './core/CursorManager';
import { createCursorManager } from './singletons/cursorManager';
import { createConfig } from './singletons/annotationConfig';
import type { AnnotatorOptions } from './core/AnnotatorConfig';
// import { relationManager } from './singletons/relationManager';
import { RelationTool } from './tools/Relation.tool';

const ToolMapping = {
  line: LineTool,
  point: PointTool,
  rect: RectTool,
  polygon: PolygonTool,
  cuboid: CuboidTool,
  relation: RelationTool,
} as const;

export class AnnotatorBase {
  public renderer: Renderer | null = null;

  public backgroundRenderer: BackgroundRenderer | null = null;

  public activeToolName: ToolName | null = null;

  public container: HTMLDivElement | null = null;

  public config: AnnotatorOptions;

  protected monitor: Monitor | null = null;

  protected tools: Map<ToolName, AnnotationTool> = new Map();

  protected axis: Axis | null = null;

  protected cursorManager: CursorManager | null = null;

  protected _toolsInitialized = false;

  private _pendingToolData: Map<ToolName, AnnotationToolData<any>> = new Map();

  /**
   * 用于外部模块通信
   *
   * @description 注意：不要与内部事件混淆
   */
  private _event: typeof eventEmitter = eventEmitter;

  constructor(params: AnnotatorOptions) {
    const { container } = params;

    if (!container) {
      throw new Error('container is required');
    }

    this.container = container;

    this.config = createConfig(params);

    this._init();
    this.render();
  }

  public _init() {
    // 添加鼠标光标
    this._initialContainer();
    this._initialAxis();
    this.monitor = createMonitor(this.renderer!.canvas, {
      getTools: () => this.tools,
    });
    this.cursorManager = createCursorManager(this.container, { x: 0, y: 0 });

    if (!this.config.editable) {
      this.cursorManager?.disable();
    }

    // this._initialTools();
    this._prepareInitialTools();
  }

  private _initialContainer() {
    const { container, width, height, image } = this.config;

    container.style.width = `${width}px`;
    container.style.height = `${height}px`;
    container.style.position = 'relative';
    container.style.overflow = 'hidden';

    this.renderer = new Renderer({ container, width, height, zIndex: 2 });
    this.backgroundRenderer = new BackgroundRenderer({
      container,
      width,
      height,
      rotate: image?.rotate,
      zIndex: 1,
    });
  }

  private _initialAxis() {
    if (!this.renderer) {
      return;
    }

    this.axis = createAxis({
      renderer: this.renderer,
    });

    eventEmitter.on(EInternalEvent.Render, this.render);
  }

  private _prepareInitialTools() {
    const { image } = this.config;

    if (image?.url) {
      // 先加载初始图片，让 axis 拿到正确的初始偏移与缩放
      this.loadImage(image.url, {
        rotate: image.rotate,
      })
        .catch((error) => {
          console.error('[AnnotatorBase] Failed to load initial image', error);
        })
        .finally(() => {
          this._setupTools();
        });
    } else {
      this._setupTools();
    }
  }

  private _setupTools() {
    if (this._toolsInitialized) {
      return;
    }

    this._initialTools();
    this._toolsInitialized = true;
    this._flushPendingToolData();
    this.render();
    this.emit('toolsReady');
  }

  private _initialTools() {
    const { config } = this;

    if (config?.strokeWidth) {
      Annotation.strokeWidth = config.strokeWidth;
    }

    if (config?.strokeOpacity) {
      Annotation.strokeOpacity = config.strokeOpacity;
    }

    if (config?.fillOpacity) {
      Annotation.fillOpacity = config.fillOpacity;
    }

    TOOL_NAMES.forEach((toolName) => {
      if (config?.[toolName]) {
        const ToolClass = ToolMapping?.[toolName];
        this.use(
          ToolClass.create({
            ...(config[toolName] as any),
            requestEdit: typeof config.requestEdit === 'function' ? config.requestEdit : () => true,
            showOrder: config.showOrder ?? false,
            getTools: () => this.tools,
          }),
        );
      }
    });
  }

  private _flushPendingToolData() {
    if (this._pendingToolData.size === 0) {
      return;
    }

    // 等图片和工具都准备好后再执行 `loadData`
    for (const [toolName, data] of this._pendingToolData.entries()) {
      if (!data) {
        continue;
      }

      this._loadDataInternal(toolName, data as AnnotationToolData<any>);
    }

    this._pendingToolData.clear();
  }

  private _enqueueToolData(toolName: ToolName, data: AnnotationToolData<any>) {
    const existing = this._pendingToolData.get(toolName) ?? [];
    const normalized: any[] = Array.isArray(existing) ? existing.slice() : [];
    const incoming = (Array.isArray(data) ? data.slice() : [data]) as any[];
    const merged = normalized.concat(incoming);

    // 工具未初始化时，暂存数据，防止坐标转换使用到错误的偏移
    this._pendingToolData.set(toolName, merged as AnnotationToolData<any>);
  }

  public use(instance: AnnotationTool) {
    const { tools } = this;
    if (tools.has(instance.name)) {
      throw new Error(`Tool ${instance.name} already exists!`);
    }

    tools.set(instance.name, instance);

    return this;
  }

  public render = () => {
    const { renderer, backgroundRenderer, tools } = this;

    if (!renderer) {
      return this;
    }

    // 清除画布
    renderer.clear();
    // 清除背景
    backgroundRenderer!.clear();

    // 渲染背景
    backgroundRenderer!.render();

    const annotations: any[] = [];

    // TODO: 更新any
    let draft: any;
    // 渲染工具
    tools.forEach((tool) => {
      tool.render(renderer!.ctx!);

      if (tool.drawing) {
        annotations.push(...Array.from(tool.drawing.values() as any));
      }

      if (tool.draft) {
        draft = tool.draft;
      }
    });

    // 按绘制顺序渲染
    annotations.sort((a, b) => a.data.order - b.data.order);

    annotations.forEach((annotation) => {
      annotation.render(renderer!.ctx!);
    });

    // relationManager.render(renderer!.ctx!);

    // 草稿在最上层
    draft?.render(renderer!.ctx!);
  };

  public loadImage(url: string, options?: Omit<ImageOption, 'container' | 'width' | 'height' | 'url' | 'zIndex'>) {
    const { config } = this;

    return this.backgroundRenderer!.loadImage(url, {
      ...options,
      width: config.width,
      height: config.height,
      container: config.container,
      rotate: config?.image?.rotate ?? 0,
    });
  }

  /**
   * 加载标注数据
   */
  public loadData<T extends ToolName>(toolName: T, data: AnnotationToolData<T>) {
    if (!data) {
      return;
    }

    if (!this._toolsInitialized) {
      this._enqueueToolData(toolName, data as AnnotationToolData<any>);
      return;
    }

    this._loadDataInternal(toolName, data as AnnotationToolData<any>);
  }

  private _loadDataInternal(toolName: ToolName, data: AnnotationToolData<any>) {
    const { config, tools } = this;
    const tool = tools.get(toolName);

    if (!config) {
      return;
    }

    const ToolClass = ToolMapping[toolName];
    const toolConfig = config[toolName];

    if (tool) {
      tool.load(data as AllTypeAnnotationDataGroup);
    } else if (TOOL_NAMES.includes(toolName)) {
      this.use(
        ToolClass.create({
          ...toolConfig,
          showOrder: config.showOrder ?? false,
          requestEdit: typeof config.requestEdit === 'function' ? config.requestEdit : () => true,
          data: data as AllTypeAnnotationDataGroup,
          getTools: () => this.tools,
        }),
      );
    } else {
      console.warn(`Tool ${toolName} is not supported`);
      return;
    }

    this.render();
    this.emit('load', toolName, data);
  }

  public destroy() {
    this.tools.forEach((tool) => {
      tool.clear();
      tool.destroy();
    });
    this._event!.removeAllListeners();
    this.tools.clear();
    this.axis?.destroy();
    this.monitor?.destroy();
    this.monitor = null;
    this.axis = null;
    this.renderer?.destroy();
    this.renderer = null;
    this.backgroundRenderer?.destroy();
    this.backgroundRenderer = null;
    this.config = null as any;
    rbush.clear();
    this._toolsInitialized = false;
    this._pendingToolData.clear();
  }

  public on = eventEmitter.on.bind(eventEmitter);
  public off = eventEmitter.off.bind(eventEmitter);
  public emit = eventEmitter.emit.bind(eventEmitter);
  public once = eventEmitter.once.bind(eventEmitter);
  public removeAllListeners = eventEmitter.removeAllListeners.bind(eventEmitter);
}
