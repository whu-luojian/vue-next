import { effect, ReactiveEffect, trigger, track } from './effect'
import { TriggerOpTypes, TrackOpTypes } from './operations'
import { Ref } from './ref'
/**
 * NOOP - 空函数
 */
import { isFunction, NOOP } from '@vue/shared'

export interface ComputedRef<T = any> extends WritableComputedRef<T> {
  readonly value: T
}

export interface WritableComputedRef<T> extends Ref<T> {
  readonly effect: ReactiveEffect<T>
}

export type ComputedGetter<T> = (ctx?: any) => T
export type ComputedSetter<T> = (v: T) => void

export interface WritableComputedOptions<T> {
  get: ComputedGetter<T>
  set: ComputedSetter<T>
}

export function computed<T>(getter: ComputedGetter<T>): ComputedRef<T>
export function computed<T>(
  options: WritableComputedOptions<T>
): WritableComputedRef<T>

/**
 * 构建计算属性
 * @param getterOrOptions getter -> readonly / getter & setter -> writable
 */
export function computed<T>(
  getterOrOptions: ComputedGetter<T> | WritableComputedOptions<T>
) {
  let getter: ComputedGetter<T>
  let setter: ComputedSetter<T>

  if (isFunction(getterOrOptions)) {
    getter = getterOrOptions
    setter = __DEV__
      ? () => {
          console.warn('Write operation failed: computed value is readonly')
        }
      : NOOP
  } else {
    getter = getterOrOptions.get
    setter = getterOrOptions.set
  }

  let dirty = true // dirty 为true，代表脏值，表示依赖的数据变了，计算属性重新计算
  let value: T
  let computed: ComputedRef<T>

  const runner = effect(getter, {
    lazy: true,
    // mark effect as computed so that it gets priority during trigger
    /**
     * 计算属性依赖的属性值变化时会执行调度器，将 dirty 设置为 true，表明下次取计算属性值时需要重新计算
     */
    scheduler: () => {
      if (!dirty) {
        dirty = true
        // 计算属性依赖的属性值变了，触发更新
        trigger(computed, TriggerOpTypes.SET, 'value')
      }
    }
  })
  computed = {
    __v_isRef: true,
    // expose effect so computed can be stopped
    effect: runner,
    get value() {
      /**
       * dirty 为 true 表示第一次取值，或计算属性依赖的属性值变了，重新计算取值
       */
      if (dirty) {
        value = runner()
        dirty = false
      }
      track(computed, TrackOpTypes.GET, 'value')
      return value
    },
    set value(newValue: T) {
      setter(newValue)
    }
  } as any
  return computed
}
