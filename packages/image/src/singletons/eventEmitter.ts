import type { EInternalEvent } from '../enums';

export type EventName =
  | EInternalEvent
  | 'hover'
  | 'move'
  | 'change'
  | 'zoom'
  | 'select'
  | 'unselect'
  | 'add'
  | 'delete'
  | 'relatedRelationDelete'
  | 'clear'
  | 'load'
  | 'labelChange'
  | 'attributesChange'
  | 'backgroundImageLoaded'
  | 'toolChange'
  | 'click'
  | 'mouseup'
  | 'dblclick'
  | 'error'
  | 'rightClick'
  | 'contextmenu'
  | 'toolsReady'
  | 'relationModeStart'
  | 'relationModeEnd';
// | 'relationCreated'
// | 'annotationModeChange';

type Listener = (...args: any[]) => void;

/** Global bus: Map delete is O(1); eventemitter3 `off` rebuilds the listener array. */
class EventBus {
  private _events = new Map<EventName, Map<Listener, boolean>>();

  private _add(name: EventName, callback: Listener, isOnce: boolean) {
    if (typeof callback !== 'function') {
      throw new TypeError('The listener must be a function');
    }

    let bucket = this._events.get(name);
    if (!bucket) {
      bucket = new Map();
      this._events.set(name, bucket);
    }
    bucket.set(callback, isOnce);
    return this;
  }

  public on(name: EventName, callback: Listener) {
    return this._add(name, callback, false);
  }

  public once(name: EventName, callback: Listener) {
    return this._add(name, callback, true);
  }

  public off(name: EventName, callback?: Listener) {
    const bucket = this._events.get(name);
    if (!bucket) {
      return this;
    }

    if (callback === undefined) {
      this._events.delete(name);
    } else {
      bucket.delete(callback);
      if (!bucket.size) {
        this._events.delete(name);
      }
    }
    return this;
  }

  public emit(name: EventName, ...args: any[]) {
    const bucket = this._events.get(name);
    if (!bucket || !bucket.size) {
      return false;
    }

    for (const [listener, isOnce] of Array.from(bucket)) {
      if (isOnce && bucket.get(listener) === true) {
        bucket.delete(listener);
      }
      listener.apply(this, args);
    }

    if (!bucket.size && this._events.get(name) === bucket) {
      this._events.delete(name);
    }
    return true;
  }

  public removeAllListeners(name?: EventName) {
    if (name === undefined) {
      this._events.clear();
    } else {
      this._events.delete(name);
    }
    return this;
  }
}

const eventEmitter = new EventBus();

function on(name: EventName, callback: Listener) {
  return eventEmitter.on(name, callback);
}

function once(name: EventName, callback: Listener) {
  return eventEmitter.once(name, callback);
}

function off(name: EventName, callback?: Listener) {
  return eventEmitter.off(name, callback);
}

function emit(name: EventName, ...args: any[]) {
  return eventEmitter.emit(name, ...args);
}

function removeAllListeners(name?: EventName) {
  return eventEmitter.removeAllListeners(name);
}

export { on, once, off, emit, removeAllListeners };
