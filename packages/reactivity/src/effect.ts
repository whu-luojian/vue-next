import { TrackOpTypes, TriggerOpTypes } from './operations'
/**
 * EMPTY_OBJ - 空对象
 */
import { EMPTY_OBJ, isArray } from '@vue/shared'

// The main WeakMap that stores {target -> key -> dep} connections.
// Conceptually, it's easier to think of a dependency as a Dep class
// which maintains a Set of subscribers, but we simply store them as
// raw Sets to reduce memory overhead.
/**
 * targetMap 存储全局的响应式对象及其所有key的依赖关系
  map : {
    [target]: {
        [key]: [effect1, effect2....]
    }
  }
 */
type Dep = Set<ReactiveEffect>
type KeyToDepMap = Map<any, Dep>
const targetMap = new WeakMap<any, KeyToDepMap>() 

/**
 * Effect 类型
 */
export interface ReactiveEffect<T = any> {
  (...args: any[]): T // 
  _isEffect: true // 是否是effect
  id: number
  active: boolean // 是否侦听中
  raw: () => T // 保存的构建effect的原始函数
  deps: Array<Dep> // 依赖数组
  options: ReactiveEffectOptions
}

/**
 * Effect options
 * effect - scheduler用于调度执行：
      const obj = reactive({ count: 1 })
      effect(() => {
        console.log(obj.count)
      })

      obj.count++
      obj.count++
      obj.count++
    定义响应式对象 obj，并在 effect 内读取它的值，这样 effect 与数据之间就会建立“联系”，
    接着我们连续三次修改 obj.count 的值，会发现 console.log 语句共打印四次（包括首次执行）。
    假如我们只需要把数据的最终的状态应用到副作用中，而不是每次变化都重新执行一次副作用函数，这将对性能有所提升。
    实际上我们可以为 effect 传递第二个参数作为选项，可以指定“调度器”。所谓调度器就是用来指定如何运行副作用函数的
    watchEffect就是使用scheduler将同一事件循环的effect合并到nextTick中执行，这样副作用函数在同一tick中只执行一次
 */
export interface ReactiveEffectOptions {
  lazy?: boolean // 懒执行，不立即执行
  computed?: boolean // 是否是计算属性，computed是特殊的effect
  scheduler?: (job: ReactiveEffect) => void // 调度器用来指定如何运行副作用函数
  onTrack?: (event: DebuggerEvent) => void // 当一个 reactive 对象属性或一个 ref 作为依赖被追踪时，将调用 onTrack, 用于调试
  onTrigger?: (event: DebuggerEvent) => void // 依赖项变更导致副作用被触发时，将调用 onTrigger, 用于调试
  onStop?: () => void // 停止侦听器时触发
}

/**
 * onTrack 或 onTrigger 时抛出的调试信息
 */
export type DebuggerEvent = {
  effect: ReactiveEffect
  target: object
  type: TrackOpTypes | TriggerOpTypes
  key: any
} & DebuggerEventExtraInfo

export interface DebuggerEventExtraInfo {
  newValue?: any
  oldValue?: any
  oldTarget?: Map<any, any> | Set<any>
}

/**
 * effect栈维护effect的依赖关系，避免死循环等。比如effect里面嵌套effect，activeEffect会丢失，所以需要effectStack进行维护
 * 可以见 ./_tests_/effect.spec.ts 里的相关测试用例
 */
const effectStack: ReactiveEffect[] = []
let activeEffect: ReactiveEffect | undefined // 当前活跃的effect

export const ITERATE_KEY = Symbol(__DEV__ ? 'iterate' : '')
export const MAP_KEY_ITERATE_KEY = Symbol(__DEV__ ? 'Map key iterate' : '')

export function isEffect(fn: any): fn is ReactiveEffect {
  return fn && fn._isEffect === true
}

export function effect<T = any>(
  fn: () => T,
  options: ReactiveEffectOptions = EMPTY_OBJ
): ReactiveEffect<T> {
  if (isEffect(fn)) {
    fn = fn.raw
  }
  // 根据传入的fn和options构建effect，computed是特殊的effect
  const effect = createReactiveEffect(fn, options)
  // lazy决定是不是首次就执行effect，computed的effect lazy为true
  if (!options.lazy) {
    effect()
  }
  return effect
}

/**
 * 停止effect
 * @param effect
 */
export function stop(effect: ReactiveEffect) {
  if (effect.active) {
    cleanup(effect) // 清除deps 对 effect 的依赖
    if (effect.options.onStop) {
      effect.options.onStop()
    }
    effect.active = false
  }
}

let uid = 0

/**
 * 关键函数，创建effect
 * @param fn
 * @param options
 */
function createReactiveEffect<T = any>(
  fn: (...args: any[]) => T,
  options: ReactiveEffectOptions
): ReactiveEffect<T> {
  const effect = function reactiveEffect(...args: unknown[]): unknown {
    if (!effect.active) {
      return options.scheduler ? undefined : fn(...args)
    }
    if (!effectStack.includes(effect)) {
      cleanup(effect)
      try {
        // 开启依赖收集，把当前 effect 放入 effectStack 中，然后讲 activeEffect 设置为当前的 effect
        enableTracking()
        effectStack.push(effect)
        activeEffect = effect
        return fn(...args)
      } finally {
        // 把当前 effect 弹出，恢复原来的收集依赖的状态，还有恢复原来的 activeEffect。
        effectStack.pop()
        resetTracking()
        activeEffect = effectStack[effectStack.length - 1]
      }
    }
  } as ReactiveEffect
  effect.id = uid++ // 自增id， 唯一标识effect
  effect._isEffect = true // 标识方法是否是effect
  effect.active = true // 是否激活
  effect.raw = fn // 保存创建effect时传入的fn
  effect.deps = [] // 持有当前 effect 的dep 数组
  effect.options = options // 创建effect时传入的options
  return effect
}

/**
 * 清除effect关联的deps对effect依赖
 * @param effect 
 */
function cleanup(effect: ReactiveEffect) {
  const { deps } = effect
  if (deps.length) {
    for (let i = 0; i < deps.length; i++) {
      deps[i].delete(effect)
    }
    deps.length = 0
  }
}

let shouldTrack = true
const trackStack: boolean[] = []

export function pauseTracking() {
  trackStack.push(shouldTrack)
  shouldTrack = false
}

export function enableTracking() {
  trackStack.push(shouldTrack)
  shouldTrack = true
}

export function resetTracking() {
  const last = trackStack.pop()
  shouldTrack = last === undefined ? true : last
}

/**
 * 依赖追踪
 * @param target ref对象或reactive对象
 * @param type track被触发的操作类型：get、has、iterate
 * @param key 追踪的属性值，如ref的value属性
 */
export function track(target: object, type: TrackOpTypes, key: unknown) {
  if (!shouldTrack || activeEffect === undefined) {
    return
  }

  // 初始化或者定位targetMap
  let depsMap = targetMap.get(target)
  if (!depsMap) {
    targetMap.set(target, (depsMap = new Map()))
  }
  let dep = depsMap.get(key)
  if (!dep) {
    depsMap.set(key, (dep = new Set()))
  }

  if (!dep.has(activeEffect)) {
    dep.add(activeEffect) // 给target的key属性添加依赖
    activeEffect.deps.push(dep) // 将依赖数组挂载在effect上，用于stop
    // 开发环境onTrack，用于调试
    if (__DEV__ && activeEffect.options.onTrack) {
      activeEffect.options.onTrack({
        effect: activeEffect,
        target,
        type,
        key
      })
    }
  }
}

/**
 * 触发更新
 * @param target // 目标对象
 * @param type // 触发更新（更改数据）的操作类型
 * @param key // 属性
 * @param newValue 
 * @param oldValue 
 * @param oldTarget 
 */
export function trigger(
  target: object,
  type: TriggerOpTypes,
  key?: unknown,
  newValue?: unknown,
  oldValue?: unknown,
  oldTarget?: Map<unknown, unknown> | Set<unknown>
) {
  const depsMap = targetMap.get(target)
  if (!depsMap) {
    // never been tracked
    return
  }

  const effects = new Set<ReactiveEffect>() // 此次 trigger 要触发执行的 effects 数组
  const add = (effectsToAdd: Set<ReactiveEffect> | undefined) => {
    if (effectsToAdd) {
      effectsToAdd.forEach(effect => {
        // effect 为 activeEffect 时不添加，因为添加本身会造成无限循环
        if (effect !== activeEffect || !shouldTrack) {
          effects.add(effect)
        } else {
          // 避免 effect 内部更改数据造成更新无限循环
          // the effect mutated its own dependency during its execution.
          // this can be caused by operations like foo.value++
          // do not trigger or we end in an infinite loop
        }
      })
    }
  }

  if (type === TriggerOpTypes.CLEAR) {
    // collection being cleared
    // trigger all effects for target
    // 对象被删了，所有key对应的依赖都更新
    depsMap.forEach(add)
  } else if (key === 'length' && isArray(target)) {
    // 更改数组的length属性触发更新
    depsMap.forEach((dep, key) => {
      // key >= (newValue as number) 表示 length 变小了，a[key > length] 变成 undefined 了，通知对应key的依赖更新
      if (key === 'length' || key >= (newValue as number)) {
        add(dep)
      }
    })
  } else {
    // 获取 key 对应的 deps，调度更新
    // schedule runs for SET | ADD | DELETE
    if (key !== void 0) {
      add(depsMap.get(key))
    }
    // also run for iteration key on ADD | DELETE | Map.SET
    const isAddOrDelete =
      type === TriggerOpTypes.ADD ||
      (type === TriggerOpTypes.DELETE && !isArray(target))
    if (
      isAddOrDelete ||
      (type === TriggerOpTypes.SET && target instanceof Map)
    ) {
      add(depsMap.get(isArray(target) ? 'length' : ITERATE_KEY))
    }
    if (isAddOrDelete && target instanceof Map) {
      add(depsMap.get(MAP_KEY_ITERATE_KEY))
    }
  }

  const run = (effect: ReactiveEffect) => {
    // 开发环境执行 onTrigger，用于调试
    if (__DEV__ && effect.options.onTrigger) {
      effect.options.onTrigger({
        effect,
        target,
        key,
        type,
        newValue,
        oldValue,
        oldTarget
      })
    }
    // 计算属性有scheduler，执行scheduler，不直接执行effect
    if (effect.options.scheduler) {
      effect.options.scheduler(effect)
    } else {
      effect()
    }
  }

  effects.forEach(run)
}
