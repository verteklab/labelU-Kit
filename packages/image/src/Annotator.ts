import Color from 'color';

import type { AnnotationData, ToolName } from './interface';
import { EInternalEvent } from './enums';
import { axis } from './singletons/axis';
import { eventEmitter, rbush } from './singletons';
import { Annotation, AnnotationMapping } from './annotations';
import type { Cursor } from './shapes';
import { Line, ShapeText } from './shapes';
import { AnnotatorBase } from './AnnotatorBase';
import type { AnnotatorOptions } from './core/AnnotatorConfig';
import type { CursorType } from './core/CursorManager';

export type { AnnotatorOptions };

export class Annotator extends AnnotatorBase {
  // /** 是否处于标注模式 */
  // private _isAnnotationMode: boolean = false;

  // /** 用户上次选择的工具名，用于退出标注模式后重新进入时恢复工具状态 */
  // private _lastSelectedToolName: ToolName | null = null;

  constructor(params: AnnotatorOptions) {
    super(params);

    // 监听内部工具切换事件（由工具本身发出）
    eventEmitter.on(EInternalEvent.ToolChange, this._handleToolChange);
    // // 监听外部工具切换事件（由UI组件发出）
    // eventEmitter.on('toolChange', this._handleExternalToolChange);
    // eventEmitter.on(EInternalEvent.LeftMouseUp, this._handleLeftClick);
    // eventEmitter.on(EInternalEvent.Escape, this._handleEscapeKey);
  }

  private _handleToolChange = (toolName: ToolName, label: string) => {
    this.switch(toolName, label);
    // // 保存用户选择的工具名，无论是否在标注模式下
    // this._lastSelectedToolName = toolName;

    // // 如果当前在标注模式下，立即切换工具
    // if (this._isAnnotationMode) {
    //   this.switch(toolName, label);
    // }
  };

  /**
   * 处理外部UI发送的工具切换事件
   */
  // private _handleExternalToolChange = (toolName: ToolName, label?: string) => {
  //   // 保存用户选择的工具名，无论是否在标注模式下
  //   this._lastSelectedToolName = toolName;

  //   // 如果当前在标注模式下，立即切换工具
  //   if (this._isAnnotationMode) {
  //     this.switch(toolName, label);
  //   }
  // };

  /**
   * 处理ESC键事件，退出标注模式
   */
  // private _handleEscapeKey = () => {
  //   if (this._isAnnotationMode) {
  //     this.exitAnnotationMode();
  //   }
  // };

  /**
   * 处理左键释放事件，在浏览模式下进入标注模式
   */
  // private _handleLeftClick = (e: MouseEvent) => {
  //   // 只有在浏览模式下才处理进入标注模式
  //   if (!this._isAnnotationMode && this.config?.editable) {
  //     // 检查是否有拖动行为，只有纯粒的点击（没有拖动）才进入标注模式
  //     if (axis && axis.isMoved) {
  //       return;
  //     }

  //     // 检查是否点击在现有标注上，如果是，则不进入标注模式
  //     if (!this._isClickingOnExistingAnnotation(e)) {
  //       this.enterAnnotationMode();
  //     }
  //   }
  // };

  /**
   * 检查是否点击在现有的标注上
   */
  // private _isClickingOnExistingAnnotation(e: MouseEvent): boolean {
  //   const point = { x: e.offsetX, y: e.offsetY };

  //   for (const tool of this.tools.values()) {
  //     if (tool.drawing) {
  //       for (const annotation of tool.drawing.values()) {
  //         if (annotation.group.isShapesUnderCursor(point)) {
  //           return true;
  //         }
  //       }
  //     }
  //   }

  //   return false;
  // }

  public rotate(angle: number) {
    const { backgroundRenderer } = this;

    const data = this.getFlatData();

    if (data.length > 0) {
      this.emit('error', {
        type: 'rotate',
        message: `Can't rotate when there are annotations`,
      });

      return;
    }

    if (!backgroundRenderer) {
      console.error('backgroundRenderer is not initialized');

      return;
    }

    backgroundRenderer.clear();
    backgroundRenderer.rotate = angle;
  }

  public resize(
    sizeOrWidth:
      | ((width: number, height: number) => { width: number; height: number })
      | { width: number; height: number }
      | number,
    height?: number,
  ) {
    const { backgroundRenderer, renderer, container } = this;

    if (!backgroundRenderer) {
      throw new Error('backgroundRenderer is not initialized');
    }

    if (!renderer) {
      throw new Error('renderer is not initialized');
    }

    if (!container) {
      throw new Error('container is not initialized');
    }

    let newSize;
    if (typeof sizeOrWidth === 'function') {
      newSize = sizeOrWidth(container.clientWidth, container.clientHeight);
    } else if (typeof sizeOrWidth === 'number' && typeof height === 'number') {
      newSize = { width: sizeOrWidth, height: height };
    } else if (typeof sizeOrWidth === 'object') {
      newSize = sizeOrWidth;
    } else {
      throw new Error('Invalid arguments');
    }

    const oldData = this.getDataByTool();

    container.style.width = `${newSize.width}px`;
    container.style.height = `${newSize.height}px`;

    renderer.resize(newSize.width, newSize.height);
    backgroundRenderer.resize(newSize.width, newSize.height);
    // resize 之后，还需要重新计算所有标注相对画布的坐标
    for (const tool of this.tools.values()) {
      tool.clear();
      tool.load(oldData[tool.name]);
    }

    this.render();
  }

  /**
   * 原图比例1:1显示
   */
  public resetScale() {
    if (!axis) {
      throw new Error('axis is not initialized');
    }

    axis.restScale(1 / axis!.initialBackgroundScale);
    axis.center();
  }

  /**
   * 居中显示
   */
  public center() {
    if (!axis) {
      throw new Error('axis is not initialized');
    }

    axis.center();
  }

  /**
   * 适应容器显示
   */
  public fit() {
    if (!axis) {
      throw new Error('axis is not initialized');
    }

    axis.restScale(1);
    axis.center();
  }

  public get toolMap() {
    return this.tools;
  }

  public setEditable(editable: boolean) {
    if (this.config) {
      this.config.editable = editable;
      if (!editable) {
        this.activeTool?.deactivate();
        this.cursorManager?.disable();
      } else {
        this.cursorManager?.enable();
      }
    } else {
      throw new Error('Annotator is destroyed');
    }
  }

  /**
   * 进入标注模式
   */
  // public enterAnnotationMode(toolName?: ToolName, label?: string) {
  //   if (this._isAnnotationMode) {
  //     return;
  //   }

  //   this._isAnnotationMode = true;

  //   // 更新全局配置
  //   if (this.config) {
  //     this.config.isAnnotationMode = true;
  //   }

  //   if (this.cursorManager) {
  //     this.cursorManager.enterAnnotationMode();
  //   }

  //   // 如果没有指定工具，优先使用用户上次选择的工具
  //   const targetToolName = toolName || this._lastSelectedToolName;

  //   if (targetToolName) {
  //     this.switch(targetToolName, label);
  //   }

  //   this.emit('annotationModeChange', true);
  // }

  /**
   * 退出标注模式
   */
  // public exitAnnotationMode() {
  //   if (!this._isAnnotationMode) {
  //     return;
  //   }

  //   this._isAnnotationMode = false;

  //   // 更新全局配置
  //   if (this.config) {
  //     this.config.isAnnotationMode = false;
  //   }

  //   if (this.cursorManager) {
  //     this.cursorManager.exitAnnotationMode();
  //   }

  //   // 取消工具激活状态
  //   if (this.activeTool) {
  //     this.activeTool.deactivate();
  //   }

  //   // 清空当前激活的工具名，确保下次进入标注模式时能正确激活工具
  //   this.activeToolName = null;

  //   this.emit('annotationModeChange', false);
  // }

  /**
   * 获取当前是否处于标注模式
   */
  // public get isAnnotationMode() {
  //   return this._isAnnotationMode;
  // }

  /**
   * 使工具进入绘制状态
   *
   * @example
   *
   * @param toolName 工具名称
   * @param label 标注类别，如果是字符串，则表示标注类别value（唯一标示）；如果是对象，则表示标注类别
   */
  public switch(toolName: ToolName, label?: string) {
    if (typeof toolName !== 'string') {
      console.error('toolName must be string, such as "line" or "point"');

      return;
    }

    if (!this.config?.editable) {
      return;
    }

    // // 始终记录用户选择的工具，无论是否在标注模式下
    // this._lastSelectedToolName = toolName;

    // // 只有在标注模式下才激活工具
    // if (!this._isAnnotationMode) {
    //   // 在浏览模式下只记录选择，不激活工具
    //   this.emit('toolChange', toolName, label || 'car'); // 触发UI更新
    //   return;
    // }

    const { activeToolName } = this;
    const tool = this.tools.get(toolName);

    if (!tool) {
      // TODO：导向到文档
      console.warn(`Tool ${toolName} is not used!`);

      return;
    }

    if (toolName === this.activeToolName && label === this.activeTool?.activeLabel) {
      return;
    }

    if (activeToolName && activeToolName !== toolName) {
      this.tools.get(activeToolName)!.deactivate();
    }

    let pickedLabel = label;

    if (!label) {
      pickedLabel = tool.labelMapping.keys().next().value;
    }

    if (activeToolName !== toolName) {
      this.activeToolName = toolName;
      this.emit('toolChange', toolName, pickedLabel);
    }

    const AnnotationClass = AnnotationMapping[toolName];

    if (this.cursorManager) {
      this.cursorManager.color = AnnotationClass.labelStatic.getLabelColor(pickedLabel);
    }

    tool.activate(pickedLabel);
    this.emit('labelChange', pickedLabel);
  }
  // TODO: 挪到Annotation里
  public set strokeWidth(value: number) {
    Annotation.strokeWidth = value;

    const { tools } = this;

    tools.forEach((tool) => {
      tool.drawing?.forEach((annotation) => {
        annotation.group.each((shape) => {
          if (!(shape instanceof ShapeText)) {
            shape.updateStyle({
              strokeWidth: value,
            });
          }
        });
      });

      if (tool.draft) {
        tool.draft.group.each((shape) => {
          if (!(shape instanceof ShapeText)) {
            shape.updateStyle({
              strokeWidth: value,
            });
          }
        });
      }
    });

    this.render();
  }

  // TODO: 挪到Annotation里
  public set strokeOpacity(value: number) {
    Annotation.strokeOpacity = value;

    const { tools } = this;

    tools.forEach((tool) => {
      tool.drawing?.forEach((annotation) => {
        const labelColor = annotation.labelColor;
        const strokeColor = Color(labelColor).alpha(value).toString();

        annotation.strokeColor = strokeColor;

        annotation.group.each((shape) => {
          if (!(shape instanceof ShapeText)) {
            shape.updateStyle({
              stroke: strokeColor,
            });
          }
        });
      });

      if (tool.draft) {
        tool.draft.group.each((shape) => {
          if (!(shape instanceof ShapeText) && !(shape instanceof Line)) {
            shape.updateStyle({
              stroke: Color(tool.draft!.labelColor).alpha(value).toString(),
            });
          }
        });
      }
    });

    this.render();
  }

  // TODO: 挪到Annotation里
  public set fillOpacity(value: number) {
    Annotation.fillOpacity = value;
    const { tools } = this;

    tools.forEach((tool) => {
      tool.drawing?.forEach((annotation) => {
        const labelColor = annotation.labelColor;
        annotation.group.each((shape) => {
          if (!(shape instanceof ShapeText) && !(shape instanceof Line)) {
            (shape as any).updateStyle({
              fill: Color(labelColor).alpha(value).toString(),
            });
          }
        });
      });

      if (tool.draft) {
        tool.draft.group.each((shape) => {
          if (!(shape instanceof ShapeText) && !(shape instanceof Line)) {
            (shape as any).updateStyle({
              fill: Color(tool.draft!.labelColor).alpha(value).toString(),
            });
          }
        });
      }
    });

    this.render();
  }

  public getFlatData() {
    const result: any = [];

    for (const tool of this.tools.values()) {
      result.push(...tool.data);
    }

    return result;
  }

  /**
   * 获取标注数据
   *
   * @param iterator 遍历函数
   */
  public getDataByTool(iterator?: (data: AnnotationData, tool: ToolName, index: number) => any) {
    const result: Record<string, any[]> = {};

    for (const tool of this.tools.values()) {
      const toolData = tool.data;
      const toolName = tool.name;

      if (typeof iterator === 'function') {
        result[toolName] = new Array(toolData.length);
        for (let i = 0; i < toolData.length; i++) {
          result[toolName][i] = iterator(toolData[i], toolName, i);
        }
      } else {
        result[toolName] = toolData;
      }
    }

    return result;
  }

  public export() {
    const { backgroundRenderer } = this;

    if (!backgroundRenderer) {
      throw new Error('backgroundRenderer is not initialized');
    }

    if (!backgroundRenderer.image) {
      throw new Error('backgroundRenderer.image is not initialized');
    }

    return {
      width: backgroundRenderer.image.width,
      height: backgroundRenderer.image.height,
      rotate: backgroundRenderer.rotateDegree,
      data: this.getDataByTool(),
    };
  }

  /**
   * 清除所有标注
   */
  public clearData() {
    this.tools.forEach((tool) => {
      tool.clear();
    });

    this.render();
    this.emit('clear');
    rbush.clear();
  }

  public get showOrder() {
    return this.config.showOrder as boolean;
  }

  public set showOrder(value: boolean) {
    this.config.showOrder = Boolean(value);

    rbush.clear();

    for (const tool of this.tools.values()) {
      tool.toggleOrderVisible(value);
    }

    this.render();
  }

  public setLabel(value: string) {
    if (typeof value !== 'string') {
      throw Error('value is not a string', value);
    }

    const { activeToolName, tools } = this;

    if (!activeToolName) {
      return;
    }
    const currentTool = tools.get(activeToolName);

    if (!currentTool) {
      return;
    }

    const AnnotationClass = AnnotationMapping[activeToolName];

    if (!currentTool.setLabel(value)) {
      return;
    }

    if (this.cursorManager) {
      this.cursorManager.color = AnnotationClass.labelStatic.getLabelColor(value);
    }

    this.render();
  }

  public get activeTool() {
    if (!this.activeToolName) {
      return;
    }

    return this.tools.get(this.activeToolName);
  }

  public registerCursor(name: CursorType, cursor: Cursor) {
    this.cursorManager?.register(name, cursor);
  }

  public unregisterCursor(name: CursorType) {
    this.cursorManager?.unregister(name);
  }

  public get keyboard() {
    return this.monitor?.keyboard;
  }

  public setAttributes(attributes: Record<string, string | string[]>) {
    const { activeToolName, tools } = this;

    if (!activeToolName) {
      return;
    }

    const currentTool = tools.get(activeToolName);

    currentTool!.setAttributes(attributes);
  }

  /**
   * 指定标注id从外部删除标注
   *
   * @param toolName 工具名称
   * @param id 标注id
   */
  public removeAnnotationById(toolName: ToolName, id: string) {
    if (!this.config.editable) {
      return;
    }

    const { tools } = this;

    const tool = tools.get(toolName);

    if (!tool) {
      return;
    }

    tool.deleteAnnotation(id);
  }

  /**
   * 指定标注id从外部选中标注
   */
  public selectAnnotation(toolName: ToolName | undefined, id: string | undefined) {
    if (!this.config.editable) {
      return;
    }

    const selectTool = toolName || this.activeTool?.name;

    if (!selectTool) {
      console.warn('Tool is not initialized');

      return;
    }

    if (!this.monitor) {
      console.warn('Annotator is not initialized');

      return;
    }

    if (this.monitor.selectedAnnotationId === id) {
      return;
    }

    if (!id) {
      if (this.monitor?.selectedAnnotationId) {
        this.activeTool?.drawing
          ?.get(this.monitor.selectedAnnotationId)
          ?.group.emit(EInternalEvent.UnSelect, new MouseEvent(''));
      }
      this.switch(selectTool);
      return;
    } else {
      // @ts-ignore
      const annotationLabel = this.tools.get(selectTool)?.data.find((item) => item.id === id)?.label;

      this.switch(selectTool, annotationLabel);
    }

    this.monitor.selectedAnnotationId = id;
    this.activeTool?.drawing?.get(id)?.group.emit(EInternalEvent.Select, new MouseEvent(''));

    this.render();
  }

  public toggleAnnotationsVisibility(toolName: ToolName, annotationIds: string[], visible: boolean) {
    const tool = this.tools.get(toolName);

    if (!tool) {
      console.warn(`Tool ${toolName} is not used!`);
      return;
    }

    tool.toggleAnnotationsVisibility(annotationIds, visible);
    this.render();
  }

  /**
   * 获取当前选中的标注
   */
  public getSelectedAnnotation(): AnnotationData | undefined {
    const { tools, monitor, activeToolName } = this;
    const selectedAnnotationId = monitor?.selectedAnnotationId;

    if (!selectedAnnotationId || !activeToolName) {
      return;
    }

    const currentToolData = tools.get(activeToolName)?.data;

    if (!currentToolData) {
      return;
    }

    return (currentToolData as AnnotationData[]).find((item) => item.id === selectedAnnotationId);
  }
}
